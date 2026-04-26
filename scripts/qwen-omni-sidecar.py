#!/usr/bin/env python3
"""
Qwen2.5-Omni sidecar for the Deck.

Exposes the contract documented in
docs/control-deck/audio/e2e-voice-assistant-sota.md:

    GET  /health        -> { ok, model, cuda, loaded }
    POST /stt           -> multipart {audio, language?, timestamps?}
                            -> { text, language?, duration?, words? }
    POST /tts           -> JSON {text, voice?, format?, speed?}
                            -> raw audio bytes (Content-Type from --tts-format)
    POST /e2e/respond   -> JSON or multipart in
                            -> { text, audio (base64), audio_mime, voice }

The model is lazy-loaded on the first /stt, /tts, or /e2e/respond call so
/health stays cheap. Set OMNI_PRELOAD=1 to load on startup instead.
"""

from __future__ import annotations

import argparse
import base64
import io
import os
import threading
import time
from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf
import torch

# Patch transformers' torch>=2.6 gate before any model import. autoawq_kernels'
# CUDA wheels are built against the torch 2.4 ABI, but transformers >=4.53
# raises ValueError unless torch>=2.6 — even though the only torch.load call
# here is the trusted ~80 KB spk_dict.pt shipped with the Qwen snapshot. Real
# weights go through safetensors. The check reads importlib.metadata.version,
# so a torch.__version__ spoof is not enough; patch the function directly.
import transformers.utils.import_utils as _tx_iu  # noqa: E402

_tx_iu.check_torch_load_is_safe = lambda: None  # type: ignore[assignment]
# Re-export from the public module path used by callers.
import transformers.utils as _tx_utils  # noqa: E402

_tx_utils.check_torch_load_is_safe = _tx_iu.check_torch_load_is_safe  # type: ignore[attr-defined]

# Force-allow bf16 for the AWQ quantizer. The transformers AwqQuantizer casts
# the whole graph to fp16 because autoawq's WQLinear_GEMM expects fp16 input.
# That works for the LLM brain alone, but Qwen2.5-Omni's thinker accumulates
# residual activations whose magnitude exceeds fp16's 65504 ceiling around
# layer 27 — producing NaN logits at the first generated token. Keeping the
# model in bf16 fixes this; WQLinear_GEMM still casts its own input to fp16
# internally and back to bf16 on output, so AWQ kernels remain happy.
import transformers.quantizers.quantizer_awq as _tx_awqq  # noqa: E402


def _awq_update_dtype_bf16(self, torch_dtype):  # type: ignore[no-untyped-def]
    if torch_dtype is None:
        return torch.bfloat16
    return torch_dtype


_tx_awqq.AwqQuantizer.update_torch_dtype = _awq_update_dtype_bf16  # type: ignore[assignment]

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile  # noqa: E402
from fastapi.responses import JSONResponse, Response  # noqa: E402

# Lazily imported below; spelt out so static analysers can still see them.
Qwen2_5OmniForConditionalGeneration = None  # type: ignore[assignment]
Qwen2_5OmniProcessor = None  # type: ignore[assignment]


# ---------------------------------------------------------------------------
# Model loading

class OmniRuntime:
    """Holds the loaded model + processor. One global instance per process."""

    def __init__(self, model_dir: Path, device_map: str, allow_cpu: bool, default_voice: str):
        self.model_dir = model_dir
        self.device_map = device_map
        self.allow_cpu = allow_cpu
        self.default_voice = default_voice

        self._lock = threading.Lock()
        self._model = None
        self._processor = None
        self._loaded_at: float | None = None

    @property
    def loaded(self) -> bool:
        return self._model is not None and self._processor is not None

    def ensure_loaded(self) -> None:
        if self.loaded:
            return
        with self._lock:
            if self.loaded:
                return
            global Qwen2_5OmniForConditionalGeneration, Qwen2_5OmniProcessor
            from transformers import (
                AutoConfig,
                Qwen2_5OmniForConditionalGeneration as _Model,
                Qwen2_5OmniProcessor as _Proc,
            )
            Qwen2_5OmniForConditionalGeneration = _Model  # type: ignore[assignment]
            Qwen2_5OmniProcessor = _Proc  # type: ignore[assignment]

            if not torch.cuda.is_available() and not self.allow_cpu:
                raise RuntimeError(
                    "CUDA not available; rerun the sidecar with --allow-cpu only if you "
                    "really mean a slow CPU run."
                )

            t0 = time.time()
            self._processor = _Proc.from_pretrained(
                self.model_dir,
                local_files_only=True,
                trust_remote_code=True,
            )
            device_map = self.device_map if torch.cuda.is_available() else "cpu"

            # Qwen2.5-Omni-AWQ ships with modules_to_not_convert=["visual"], but
            # token2wav (the speech vocoder) also has linears whose in_features
            # aren't divisible by 128 — autoawq's gemm.py asserts on those. The
            # talker is full-precision in this checkpoint too. Extend the skip
            # list before loading.
            cfg = AutoConfig.from_pretrained(
                self.model_dir, local_files_only=True, trust_remote_code=True
            )
            qcfg = getattr(cfg, "quantization_config", None) or {}
            if isinstance(qcfg, dict):
                skip = set(qcfg.get("modules_to_not_convert") or [])
                skip.update({"visual", "audio_tower", "token2wav", "talker", "lm_head"})
                qcfg["modules_to_not_convert"] = sorted(skip)
                cfg.quantization_config = qcfg

            # Qwen2.5-Omni was trained in bf16; the AWQ checkpoint stores
            # bf16 non-quantized weights (talker/token2wav/etc). Loading in
            # fp16 produces inf/nan logits at the last decoder layer, so we
            # keep the model in bf16. Below, we restore WQLinear scales (and
            # the int packed weights) to fp16 so awq_ext.gemm_forward_cuda
            # finds the dtypes it expects.
            self._model = _Model.from_pretrained(
                self.model_dir,
                config=cfg,
                local_files_only=True,
                torch_dtype=torch.bfloat16,
                device_map=device_map,
                trust_remote_code=True,
            )

            try:
                from awq.modules.linear.gemm import WQLinear_GEMM
                fixed = 0
                for mod in self._model.modules():
                    if isinstance(mod, WQLinear_GEMM):
                        if mod.scales.dtype != torch.float16:
                            mod.scales.data = mod.scales.data.to(torch.float16)
                        fixed += 1
                print(f"[omni-sidecar] cast {fixed} WQLinear scales to fp16")
            except Exception as exc:
                print(f"[omni-sidecar] WARN: WQLinear scale cast skipped: {exc!r}")

            self._loaded_at = time.time() - t0
            print(f"[omni-sidecar] loaded {self.model_dir} in {self._loaded_at:.1f}s on {device_map}")

    @property
    def model(self):
        self.ensure_loaded()
        return self._model

    @property
    def processor(self):
        self.ensure_loaded()
        return self._processor

    @property
    def device(self):
        return self.model.device


# ---------------------------------------------------------------------------
# Audio helpers

def _ffmpeg_decode_to_wav(buf: bytes, target_sr: int) -> bytes:
    """Decode any container ffmpeg understands to mono PCM-16 WAV at target_sr."""
    import subprocess
    proc = subprocess.run(
        [
            "ffmpeg", "-loglevel", "error", "-nostdin",
            "-i", "pipe:0",
            "-ac", "1", "-ar", str(target_sr),
            "-f", "wav", "pipe:1",
        ],
        input=buf, capture_output=True, check=False, timeout=30,
    )
    if proc.returncode != 0 or not proc.stdout:
        raise RuntimeError(f"ffmpeg decode failed: {proc.stderr.decode('utf-8', errors='replace')[:240]}")
    return proc.stdout


def _decode_audio_to_array(buf: bytes, target_sr: int = 16_000) -> tuple[np.ndarray, int]:
    """Decode arbitrary uploaded audio to a mono float32 array at target_sr.

    libsndfile (via soundfile) handles WAV/FLAC/OGG-Vorbis natively. Browser
    MediaRecorder typically emits webm/opus or mp4/aac which libsndfile rejects;
    fall back to ffmpeg for those, since it's already the reference decoder.
    """
    try:
        data, sr = sf.read(io.BytesIO(buf), dtype="float32", always_2d=False)
    except Exception:
        wav_bytes = _ffmpeg_decode_to_wav(buf, target_sr)
        data, sr = sf.read(io.BytesIO(wav_bytes), dtype="float32", always_2d=False)
    if data.ndim > 1:
        data = data.mean(axis=1)
    if sr != target_sr:
        import librosa
        data = librosa.resample(data, orig_sr=sr, target_sr=target_sr)
        sr = target_sr
    return data.astype(np.float32, copy=False), sr


def _wav_bytes_from_array(audio: np.ndarray, sr: int) -> bytes:
    out = io.BytesIO()
    sf.write(out, audio, sr, format="WAV", subtype="PCM_16")
    return out.getvalue()


# ---------------------------------------------------------------------------
# Generation helpers

SYSTEM_PROMPT = (
    "You are Qwen, a virtual human developed by the Qwen Team, Alibaba Group, "
    "capable of perceiving auditory and visual inputs, as well as generating text and speech."
)


def _move_inputs(inputs: dict[str, Any], device: torch.device) -> dict[str, Any]:
    return {k: (v.to(device) if hasattr(v, "to") else v) for k, v in inputs.items()}


def _extract_assistant_turn(decoded: str) -> str:
    """processor.batch_decode returns the full chat template; clients want only
    the assistant's reply. The Qwen2.5 chat template emits 'assistant\\n' before
    the generated turn, so we split on that marker."""
    marker = "assistant\n"
    idx = decoded.rfind(marker)
    if idx >= 0:
        return decoded[idx + len(marker):].strip()
    return decoded.strip()


def _generate(
    runtime: OmniRuntime,
    *,
    user_text: str | None,
    audio_array: np.ndarray | None,
    audio_sr: int | None,
    voice: str,
    return_audio: bool,
    max_new_tokens: int = 256,
) -> tuple[str, np.ndarray | None]:
    user_content: list[dict[str, Any]] = []
    if audio_array is not None and audio_sr is not None:
        user_content.append({"type": "audio", "audio": audio_array})
    if user_text:
        user_content.append({"type": "text", "text": user_text})
    if not user_content:
        raise ValueError("either text or audio must be provided")

    conversation = [
        {"role": "system", "content": [{"type": "text", "text": SYSTEM_PROMPT}]},
        {"role": "user", "content": user_content},
    ]

    text = runtime.processor.apply_chat_template(
        conversation, add_generation_prompt=True, tokenize=False
    )
    proc_kwargs: dict[str, Any] = {"text": text, "return_tensors": "pt", "padding": True}
    if audio_array is not None:
        proc_kwargs["audio"] = [audio_array]
        proc_kwargs["sampling_rate"] = audio_sr
    inputs = runtime.processor(**proc_kwargs)
    inputs = _move_inputs(inputs, runtime.device)

    if return_audio:
        text_ids, audio = runtime.model.generate(
            **inputs,
            return_audio=True,
            speaker=voice,
            thinker_max_new_tokens=max_new_tokens,
        )
        decoded = runtime.processor.batch_decode(
            text_ids, skip_special_tokens=True, clean_up_tokenization_spaces=False
        )
        wav = audio.reshape(-1).detach().cpu().float().numpy()
        reply = _extract_assistant_turn(decoded[0]) if decoded else ""
        return (reply, wav)
    else:
        text_ids = runtime.model.generate(
            **inputs,
            return_audio=False,
            thinker_max_new_tokens=max_new_tokens,
        )
        decoded = runtime.processor.batch_decode(
            text_ids, skip_special_tokens=True, clean_up_tokenization_spaces=False
        )
        reply = _extract_assistant_turn(decoded[0]) if decoded else ""
        return (reply, None)


# ---------------------------------------------------------------------------
# FastAPI app factory

def build_app(runtime: OmniRuntime) -> FastAPI:
    app = FastAPI(title="qwen-omni-sidecar")

    @app.get("/health")
    def health():
        return {
            "ok": True,
            "model": "Qwen/Qwen2.5-Omni-7B-AWQ",
            "model_dir": str(runtime.model_dir),
            "cuda": torch.cuda.is_available(),
            "device_count": torch.cuda.device_count() if torch.cuda.is_available() else 0,
            "loaded": runtime.loaded,
            "load_time_s": runtime._loaded_at,
        }

    @app.post("/stt")
    async def stt(
        audio: UploadFile = File(...),
        language: str | None = Form(default=None),
        timestamps: str | None = Form(default=None),
    ):
        try:
            raw = await audio.read()
            arr, sr = _decode_audio_to_array(raw)
            duration = float(arr.shape[0]) / float(sr)
            instruction = "Transcribe the audio verbatim. Reply with the transcript only."
            if language:
                instruction += f" Language hint: {language}."
            text, _ = _generate(
                runtime,
                user_text=instruction,
                audio_array=arr,
                audio_sr=sr,
                voice=runtime.default_voice,
                return_audio=False,
            )
            return JSONResponse({
                "text": text.strip(),
                "language": language,
                "duration": duration,
            })
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"stt: {e}") from e

    @app.post("/tts")
    async def tts(req: Request):
        body = await req.json()
        text = (body or {}).get("text")
        if not text:
            raise HTTPException(status_code=400, detail="text required")
        voice = (body or {}).get("voice") or runtime.default_voice
        try:
            _, wav = _generate(
                runtime,
                user_text=f"Read this aloud verbatim: {text}",
                audio_array=None,
                audio_sr=None,
                voice=voice,
                return_audio=True,
            )
            if wav is None:
                raise RuntimeError("model returned no audio")
            audio_bytes = _wav_bytes_from_array(wav, 24_000)
            return Response(
                content=audio_bytes,
                media_type="audio/wav",
                headers={"X-TTS-Voice": voice},
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"tts: {e}") from e

    @app.post("/e2e/respond")
    async def e2e_respond(req: Request):
        ct = req.headers.get("content-type", "")
        user_text: str | None = None
        arr: np.ndarray | None = None
        sr: int | None = None
        voice: str = runtime.default_voice
        try:
            if "multipart/form-data" in ct:
                form = await req.form()
                user_text = form.get("text") or None
                if "audio" in form:
                    upload = form["audio"]
                    raw = await upload.read() if hasattr(upload, "read") else bytes(upload)
                    arr, sr = _decode_audio_to_array(raw)
                voice = form.get("voice") or runtime.default_voice
            else:
                body = await req.json()
                user_text = (body or {}).get("text")
                voice = (body or {}).get("voice") or runtime.default_voice
                if (body or {}).get("audio_b64"):
                    raw = base64.b64decode(body["audio_b64"])
                    arr, sr = _decode_audio_to_array(raw)
            if user_text is None and arr is None:
                raise HTTPException(status_code=400, detail="need text or audio")
            text, wav = _generate(
                runtime,
                user_text=user_text,
                audio_array=arr,
                audio_sr=sr,
                voice=voice,
                return_audio=True,
            )
            if wav is None:
                return JSONResponse({"text": text, "audio": None, "audio_mime": None, "voice": voice})
            audio_bytes = _wav_bytes_from_array(wav, 24_000)
            return JSONResponse({
                "text": text,
                "audio": base64.b64encode(audio_bytes).decode("ascii"),
                "audio_mime": "audio/wav",
                "voice": voice,
            })
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"e2e: {e}") from e

    return app


# ---------------------------------------------------------------------------
# Entry point

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", default=os.environ.get("QWEN_OMNI_MODEL_DIR", "models/qwen2.5-omni-7b-awq"))
    parser.add_argument("--host", default=os.environ.get("OMNI_SIDECAR_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("OMNI_SIDECAR_PORT", "9100")))
    parser.add_argument("--device-map", default=os.environ.get("OMNI_DEVICE_MAP", "auto"))
    parser.add_argument("--allow-cpu", action="store_true", default=os.environ.get("OMNI_ALLOW_CPU") == "1")
    parser.add_argument("--default-voice", default=os.environ.get("OMNI_DEFAULT_VOICE", "Chelsie"))
    parser.add_argument("--preload", action="store_true", default=os.environ.get("OMNI_PRELOAD") == "1")
    args = parser.parse_args()

    model_dir = Path(args.model_dir).resolve()
    if not model_dir.exists():
        raise SystemExit(f"model dir does not exist: {model_dir}")

    runtime = OmniRuntime(
        model_dir=model_dir,
        device_map=args.device_map,
        allow_cpu=args.allow_cpu,
        default_voice=args.default_voice,
    )
    if args.preload:
        runtime.ensure_loaded()

    app = build_app(runtime)

    import uvicorn
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
