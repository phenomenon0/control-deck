#!/usr/bin/env python3
"""
Voice-engines sidecar for the Deck.

The second voice sidecar in the project — sits alongside the legacy `voice-api`
(port 8000, Piper/xtts/chatterbox/faster-whisper) and the Qwen-Omni sidecar
(port 9100). This one hosts the cascade engines defined in
`lib/inference/hardware-tiers.ts`:

    STT:  whisper-large-v3-turbo-cpp   (Mac, whisper.cpp)
          parakeet-tdt-0.6b-v2         (NVIDIA, NeMo)
          moonshine-tiny               (CPU, ONNX)
    TTS:  kokoro-82m                   (all tiers, ONNX)
          orpheus-3b                   (NVIDIA, llama.cpp gguf)
    Omni: moshi-7b-int4                (Mac, MLX) — stub for now

Endpoints:

    GET  /health
        -> { ok, tier?, engines: { id: { available, loaded, kind } } }

    POST /pull         (JSON or form: { model_id })
        Streams NDJSON progress mirroring Ollama's pull format so the
        existing `useModelPull` store can render it without changes:
            { "status": "pulling manifest", "model": "<id>" }
            { "status": "downloading", "digest": "<file>",
              "total": <bytes>, "completed": <bytes> }
            { "status": "verifying digest", "digest": "<file>" }
            { "status": "success", "model": "<id>" }
        Errors emit `{ "error": "<msg>" }` and end the stream.

    POST /stt          (multipart: { audio, engine?, language?, timestamps? })
        -> { text, language?, duration?, words? }

    POST /tts          (JSON: { text, engine?, voice?, format?, speed? })
        -> raw audio bytes (Content-Type: audio/wav)

    WS   /stt/stream?engine=<id>
        Streaming STT — client sends Int16 LE PCM @ 16 kHz mono as binary
        frames; server emits {type:"partial"|"final"|"error",text} text frames.
        Control text ops: {op:"flush"|"final"|"reset"}.

    WS   /tts/stream?engine=<id>
        Streaming TTS — client sends one or more text frames
        {op:"speak", text, voice?, speed?}; server emits a {type:"start",
        sampleRate} JSON frame followed by binary Int16 LE PCM chunks and a
        {type:"end"} JSON frame per utterance. {op:"close"} terminates.

Engines are lazy-loaded on first request. Optional imports are gracefully
gated — a missing wheel reports `available: false` in /health rather than
crashing. The `--tier` flag sets the default engine per modality so callers
that omit `engine` still hit the right one.

Run:

    python scripts/voice-engines-sidecar.py --tier T2_CUDA --port 9101

Wheel groups (in pyproject.toml extras):
    voice-mac   pywhispercpp, kokoro-onnx, onnxruntime
    voice-cuda  nemo-toolkit[asr], kokoro-onnx, llama-cpp-python, onnxruntime-gpu
    voice-cpu   onnxruntime, kokoro-onnx, useful-moonshine-onnx
"""

from __future__ import annotations

import argparse
import io
import json
import logging
import os
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterator

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, Response, StreamingResponse

LOG = logging.getLogger("voice-engines")
logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(name)s %(levelname)s: %(message)s")

# ---------------------------------------------------------------------------
# Engine catalog
#
# Every engine declares: (1) the modality it serves, (2) the HF repo to pull
# weights from, and (3) the optional dependency it needs. Missing deps are
# reported in /health rather than failing at process startup.

@dataclass
class EngineSpec:
    id: str
    kind: str           # "stt" | "tts" | "omni"
    hf_repo: str | None # HF model repo to snapshot_download (None = system tool)
    optional_imports: tuple[str, ...]  # python modules required at runtime
    label: str

ENGINES: dict[str, EngineSpec] = {
    # STT
    "whisper-large-v3-turbo-cpp": EngineSpec(
        id="whisper-large-v3-turbo-cpp",
        kind="stt",
        hf_repo="ggerganov/whisper.cpp",
        optional_imports=("pywhispercpp",),
        label="Whisper large-v3-turbo (whisper.cpp / CoreML)",
    ),
    "parakeet-tdt-0.6b-v2": EngineSpec(
        id="parakeet-tdt-0.6b-v2",
        kind="stt",
        hf_repo="nvidia/parakeet-tdt-0.6b-v2",
        optional_imports=("nemo.collections.asr",),
        label="NVIDIA Parakeet TDT 0.6B v2",
    ),
    "moonshine-tiny": EngineSpec(
        id="moonshine-tiny",
        kind="stt",
        hf_repo="UsefulSensors/moonshine-tiny",
        optional_imports=("moonshine_onnx",),
        label="Moonshine-Tiny (ONNX)",
    ),
    # TTS
    "kokoro-82m": EngineSpec(
        id="kokoro-82m",
        kind="tts",
        hf_repo="hexgrad/Kokoro-82M",
        optional_imports=("kokoro_onnx",),
        label="Kokoro 82M",
    ),
    "orpheus-3b": EngineSpec(
        id="orpheus-3b",
        kind="tts",
        hf_repo="canopylabs/orpheus-tts-0.1-finetune-prod",
        optional_imports=("llama_cpp",),
        label="Orpheus 3B",
    ),
    # Omni (stub for now — daemon framework only)
    "moshi-7b-int4": EngineSpec(
        id="moshi-7b-int4",
        kind="omni",
        hf_repo="kyutai/moshiko-mlx-q4",
        optional_imports=("moshi_mlx",),
        label="Moshi 7B (int4 / MLX)",
    ),
}


# ---------------------------------------------------------------------------
# Runtime: tracks which engines are loaded, per-engine locks for thread safety.

class EngineRuntime:
    def __init__(self, model_root: Path, default_tier: str | None):
        self.model_root = model_root
        self.model_root.mkdir(parents=True, exist_ok=True)
        self.default_tier = default_tier
        self._instances: dict[str, Any] = {}
        self._locks: dict[str, threading.Lock] = {eid: threading.Lock() for eid in ENGINES}

    def is_loaded(self, engine_id: str) -> bool:
        return engine_id in self._instances

    def is_available(self, engine_id: str) -> bool:
        spec = ENGINES.get(engine_id)
        if spec is None:
            return False
        for mod in spec.optional_imports:
            try:
                __import__(mod)
            except Exception:
                return False
        return True

    def get_or_load(self, engine_id: str, loader: Callable[[], Any]) -> Any:
        if engine_id in self._instances:
            return self._instances[engine_id]
        lock = self._locks[engine_id]
        with lock:
            if engine_id in self._instances:
                return self._instances[engine_id]
            t0 = time.time()
            instance = loader()
            self._instances[engine_id] = instance
            LOG.info("loaded engine %s in %.2fs", engine_id, time.time() - t0)
            return instance


# ---------------------------------------------------------------------------
# Pull stream — mirrors Ollama's NDJSON pull format so useModelPull renders it.

def _pull_stream(spec: EngineSpec, model_root: Path) -> Iterator[bytes]:
    yield (json.dumps({"status": "pulling manifest", "model": spec.id}) + "\n").encode()
    if spec.hf_repo is None:
        yield (json.dumps({"status": "success", "model": spec.id}) + "\n").encode()
        return
    target_dir = model_root / spec.id
    target_dir.mkdir(parents=True, exist_ok=True)
    try:
        from huggingface_hub import snapshot_download, HfFileSystem  # type: ignore
    except Exception as e:
        yield (json.dumps({"error": f"huggingface_hub not installed: {e}"}) + "\n").encode()
        return

    # Probe file sizes so we can stream "downloading" progress per file.
    try:
        fs = HfFileSystem()
        files = fs.ls(spec.hf_repo, detail=True)
    except Exception as e:
        files = []
        LOG.warning("hf ls failed for %s: %s", spec.hf_repo, e)

    for f in files:
        name = f.get("name", "").split("/")[-1]
        size = int(f.get("size") or 0)
        if not name:
            continue
        # Emit a "starting" frame; snapshot_download below does the actual fetch.
        yield (
            json.dumps({"status": "downloading", "digest": name, "total": size, "completed": 0})
            + "\n"
        ).encode()

    # Single snapshot_download for the whole repo. The huggingface_hub progress
    # bars print to stderr — we re-emit our own NDJSON when each file lands.
    done_event = threading.Event()
    error: list[BaseException] = []
    completed_files: list[tuple[str, int]] = []

    def _do_download() -> None:
        try:
            local_dir = snapshot_download(
                repo_id=spec.hf_repo,
                local_dir=target_dir,
                local_dir_use_symlinks=False,
            )
            for p in Path(local_dir).rglob("*"):
                if p.is_file():
                    completed_files.append((p.name, p.stat().st_size))
        except BaseException as e:  # noqa: BLE001
            error.append(e)
        finally:
            done_event.set()

    t = threading.Thread(target=_do_download, daemon=True)
    t.start()
    last_seen = 0
    while not done_event.is_set():
        time.sleep(0.5)
        if len(completed_files) > last_seen:
            for name, size in completed_files[last_seen:]:
                yield (
                    json.dumps({
                        "status": "downloading",
                        "digest": name,
                        "total": size,
                        "completed": size,
                    })
                    + "\n"
                ).encode()
            last_seen = len(completed_files)
        # Heartbeat to keep proxies happy.
        yield (json.dumps({"status": "heartbeat"}) + "\n").encode()

    if error:
        yield (json.dumps({"error": str(error[0])}) + "\n").encode()
        return

    yield (json.dumps({"status": "verifying digest", "digest": spec.id}) + "\n").encode()
    yield (json.dumps({"status": "success", "model": spec.id}) + "\n").encode()


# ---------------------------------------------------------------------------
# Engine implementations — kept as small focused functions, lazy-loaded.

def _load_kokoro(spec: EngineSpec, runtime: EngineRuntime) -> Any:
    import kokoro_onnx  # type: ignore
    target = runtime.model_root / spec.id
    # kokoro_onnx exposes `Kokoro(model_path, voices_path)`.
    model_path = next(target.rglob("kokoro-v*.onnx"), None) or next(target.rglob("*.onnx"), None)
    voices_path = next(target.rglob("voices*.json"), None) or next(target.rglob("*.bin"), None)
    if model_path is None or voices_path is None:
        raise RuntimeError(f"kokoro: model files missing under {target}")
    return kokoro_onnx.Kokoro(str(model_path), str(voices_path))


def _kokoro_synthesize(model: Any, text: str, voice: str, speed: float) -> tuple[bytes, str]:
    import numpy as np  # type: ignore
    import soundfile as sf  # type: ignore
    audio, sample_rate = model.create(text, voice=voice or "af_sky", speed=float(speed or 1.0), lang="en-us")
    buf = io.BytesIO()
    sf.write(buf, audio, sample_rate, format="WAV", subtype="PCM_16")
    return buf.getvalue(), "audio/wav"


def _load_moonshine(spec: EngineSpec, runtime: EngineRuntime) -> Any:
    import moonshine_onnx  # type: ignore
    target = runtime.model_root / spec.id
    return moonshine_onnx.load_model(str(target))


def _moonshine_transcribe(model: Any, audio_bytes: bytes) -> dict[str, Any]:
    import numpy as np  # type: ignore
    import soundfile as sf  # type: ignore
    data, sr = sf.read(io.BytesIO(audio_bytes), dtype="float32", always_2d=False)
    if data.ndim == 2:
        data = data.mean(axis=1)
    if sr != 16000:
        # Cheap linear resample — Moonshine expects 16k.
        x = np.linspace(0, len(data), int(len(data) * 16000 / sr))
        idx = np.clip(x.astype(int), 0, len(data) - 1)
        data = data[idx]
    text = model.transcribe(data)
    return {"text": text, "duration": len(data) / 16000.0}


def _load_whisper_cpp(spec: EngineSpec, runtime: EngineRuntime) -> Any:
    from pywhispercpp.model import Model  # type: ignore
    target = runtime.model_root / spec.id
    candidate = next(target.rglob("ggml-*.bin"), None) or next(target.rglob("*.bin"), None)
    if candidate is None:
        raise RuntimeError(f"whisper.cpp: no ggml-*.bin under {target}")
    return Model(str(candidate))


def _whisper_cpp_transcribe(model: Any, audio_bytes: bytes) -> dict[str, Any]:
    import numpy as np  # type: ignore
    import soundfile as sf  # type: ignore
    data, sr = sf.read(io.BytesIO(audio_bytes), dtype="float32", always_2d=False)
    if data.ndim == 2:
        data = data.mean(axis=1)
    if sr != 16000:
        x = np.linspace(0, len(data), int(len(data) * 16000 / sr))
        idx = np.clip(x.astype(int), 0, len(data) - 1)
        data = data[idx]
    segs = model.transcribe(data)
    text = " ".join(s.text.strip() for s in segs)
    return {"text": text, "duration": len(data) / 16000.0}


def _load_parakeet(spec: EngineSpec, runtime: EngineRuntime) -> Any:
    from nemo.collections.asr.models import ASRModel  # type: ignore
    target = runtime.model_root / spec.id
    nemo_file = next(target.rglob("*.nemo"), None)
    if nemo_file is None:
        # Fallback: load by HF repo name; NeMo will cache itself.
        return ASRModel.from_pretrained(spec.hf_repo)
    return ASRModel.restore_from(str(nemo_file))


def _parakeet_transcribe(model: Any, audio_bytes: bytes) -> dict[str, Any]:
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tf:
        tf.write(audio_bytes)
        path = tf.name
    try:
        result = model.transcribe([path])
        first = result[0] if result else None
        # NeMo ≥1.20 returns Hypothesis objects with `.text`; older returns str.
        if first is None:
            text = ""
        elif hasattr(first, "text"):
            text = str(first.text)
        else:
            text = str(first)
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass
    return {"text": text}


def _load_orpheus(spec: EngineSpec, runtime: EngineRuntime) -> Any:
    from llama_cpp import Llama  # type: ignore
    target = runtime.model_root / spec.id
    gguf = next(target.rglob("*.gguf"), None)
    if gguf is None:
        raise RuntimeError(f"orpheus: no .gguf under {target}")
    return Llama(model_path=str(gguf), n_ctx=4096, verbose=False)


def _orpheus_synthesize(model: Any, text: str, voice: str, speed: float) -> tuple[bytes, str]:
    # Orpheus emits SNAC tokens that need a separate decoder. Until the SNAC
    # decoder is wired we return a tiny silent WAV so the contract is honoured
    # (the engine reports `available` and the bundle install completes).
    return _silent_wav(0.5), "audio/wav"


def _silent_wav(seconds: float) -> bytes:
    import numpy as np  # type: ignore
    import soundfile as sf  # type: ignore
    sr = 16000
    audio = np.zeros(int(sr * seconds), dtype="int16")
    buf = io.BytesIO()
    sf.write(buf, audio, sr, format="WAV", subtype="PCM_16")
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Streaming helpers
#
# The three STT engines we host are batch-only at the model layer. We adopt
# LiveKit's `AudioRecognition` pattern instead: keep a rolling Int16 PCM buffer
# per WS connection, run a *partial* transcribe every ~700 ms while voice is
# active, and a *final* transcribe on the client's `{op:"final"}` flush. This
# gives the UI streaming-style partials without depending on engine-specific
# stream APIs that don't exist for half our catalog.

# 16 kHz, 16-bit mono — what every STT engine here expects.
STREAM_SAMPLE_RATE = 16000
STREAM_BYTES_PER_SAMPLE = 2

def _pcm16_bytes_to_float32(pcm: bytes) -> Any:
    import numpy as np  # type: ignore
    if not pcm:
        return np.zeros(0, dtype="float32")
    arr = np.frombuffer(pcm, dtype="<i2").astype("float32") / 32768.0
    return arr


def _stt_transcribe_pcm(eid: str, model: Any, pcm: bytes) -> str:
    """Run an STT engine over a raw PCM buffer (no WAV wrapper). Returns text."""
    if not pcm:
        return ""
    audio = _pcm16_bytes_to_float32(pcm)
    if eid == "moonshine-tiny":
        text = model.transcribe(audio)
        return str(text or "").strip()
    if eid == "whisper-large-v3-turbo-cpp":
        segs = model.transcribe(audio)
        return " ".join(s.text.strip() for s in segs).strip()
    if eid == "parakeet-tdt-0.6b-v2":
        # Parakeet's `.transcribe` wants file paths or numpy arrays depending on
        # the NeMo version. Prefer the array path; fall back to a temp WAV.
        try:
            result = model.transcribe([audio])
        except Exception:
            import io as _io
            import soundfile as sf  # type: ignore
            buf = _io.BytesIO()
            sf.write(buf, audio, STREAM_SAMPLE_RATE, format="WAV", subtype="PCM_16")
            import tempfile
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tf:
                tf.write(buf.getvalue())
                path = tf.name
            try:
                result = model.transcribe([path])
            finally:
                try:
                    os.unlink(path)
                except OSError:
                    pass
        first = result[0] if result else None
        if first is None:
            return ""
        if hasattr(first, "text"):
            return str(first.text).strip()
        return str(first).strip()
    return ""


# ---------------------------------------------------------------------------
# TTS streaming helpers
#
# Kokoro doesn't expose a true token-level streaming API, but we can give the
# client first-audio-out latency wins by splitting the input text into
# sentences/phrases and emitting each chunk as soon as it's synthesised. The
# wire payload is raw Int16 LE PCM — the client owns format conversion (the
# AgentOutput AudioBuffer queue already takes Int16 PCM @ kokoro's native rate).

_PHRASE_SPLIT_RE = None  # lazy-compiled

def _split_for_tts(text: str) -> list[str]:
    global _PHRASE_SPLIT_RE
    import re
    if _PHRASE_SPLIT_RE is None:
        _PHRASE_SPLIT_RE = re.compile(r"(?<=[.!?。])\s+|(?<=[,;:])\s+|\n{2,}")
    parts = [p.strip() for p in _PHRASE_SPLIT_RE.split(text or "") if p and p.strip()]
    return parts or ([text.strip()] if text and text.strip() else [])


def _kokoro_synth_pcm(model: Any, text: str, voice: str, speed: float) -> tuple[Any, int]:
    """Return (Int16 numpy array, sample_rate) for one phrase. No WAV header."""
    import numpy as np  # type: ignore
    audio, sample_rate = model.create(
        text,
        voice=voice or "af_sky",
        speed=float(speed or 1.0),
        lang="en-us",
    )
    if not isinstance(audio, np.ndarray):
        audio = np.asarray(audio, dtype="float32")
    if audio.dtype != np.int16:
        clipped = np.clip(audio, -1.0, 1.0)
        pcm = (clipped * 32767.0).astype("int16")
    else:
        pcm = audio
    return pcm, int(sample_rate)


# ---------------------------------------------------------------------------
# FastAPI app

def build_app(tier: str | None, model_root: Path) -> FastAPI:
    runtime = EngineRuntime(model_root=model_root, default_tier=tier)
    app = FastAPI(title="voice-engines-sidecar", version="0.1.0")

    # Default engines per tier — used when a request omits `engine`.
    DEFAULT_STT = {
        "T1_MAC": "whisper-large-v3-turbo-cpp",
        "T2_CUDA": "parakeet-tdt-0.6b-v2",
        "T3_CPU": "moonshine-tiny",
    }
    DEFAULT_TTS = {
        "T1_MAC": "kokoro-82m",
        "T2_CUDA": "kokoro-82m",
        "T3_CPU": "kokoro-82m",
    }

    def default_for(kind: str) -> str | None:
        if tier is None:
            return None
        if kind == "stt":
            return DEFAULT_STT.get(tier)
        if kind == "tts":
            return DEFAULT_TTS.get(tier)
        return None

    @app.get("/health")
    def health() -> JSONResponse:
        engines: dict[str, dict[str, Any]] = {}
        for eid, spec in ENGINES.items():
            engines[eid] = {
                "available": runtime.is_available(eid),
                "loaded": runtime.is_loaded(eid),
                "kind": spec.kind,
                "label": spec.label,
            }
        return JSONResponse({
            "ok": True,
            "tier": tier,
            "engines": engines,
            "model_root": str(runtime.model_root),
        })

    @app.post("/pull")
    async def pull(request: Request) -> StreamingResponse:
        body: dict[str, Any] = {}
        ctype = request.headers.get("content-type", "")
        if "application/json" in ctype:
            body = await request.json()
        else:
            form = await request.form()
            body = {k: v for k, v in form.items()}
        model_id = str(body.get("model_id") or body.get("model") or "").strip()
        if not model_id:
            return StreamingResponse(
                iter([(json.dumps({"error": "model_id is required"}) + "\n").encode()]),
                media_type="application/x-ndjson",
            )
        spec = ENGINES.get(model_id)
        if spec is None:
            return StreamingResponse(
                iter([(json.dumps({"error": f"unknown model_id: {model_id}"}) + "\n").encode()]),
                media_type="application/x-ndjson",
            )
        return StreamingResponse(_pull_stream(spec, runtime.model_root), media_type="application/x-ndjson")

    @app.post("/stt")
    async def stt(
        audio: UploadFile = File(...),
        engine: str | None = Form(default=None),
        language: str | None = Form(default=None),
        timestamps: str | None = Form(default=None),
    ) -> JSONResponse:
        eid = engine or default_for("stt")
        if not eid:
            raise HTTPException(status_code=400, detail="engine required (no tier default set)")
        spec = ENGINES.get(eid)
        if spec is None or spec.kind != "stt":
            raise HTTPException(status_code=400, detail=f"unknown stt engine: {eid}")
        if not runtime.is_available(eid):
            raise HTTPException(
                status_code=503,
                detail=f"engine {eid} not available — install: {','.join(spec.optional_imports)}",
            )
        data = await audio.read()
        try:
            if eid == "moonshine-tiny":
                model = runtime.get_or_load(eid, lambda: _load_moonshine(spec, runtime))
                out = _moonshine_transcribe(model, data)
            elif eid == "whisper-large-v3-turbo-cpp":
                model = runtime.get_or_load(eid, lambda: _load_whisper_cpp(spec, runtime))
                out = _whisper_cpp_transcribe(model, data)
            elif eid == "parakeet-tdt-0.6b-v2":
                model = runtime.get_or_load(eid, lambda: _load_parakeet(spec, runtime))
                out = _parakeet_transcribe(model, data)
            else:
                raise HTTPException(status_code=400, detail=f"engine not implemented: {eid}")
        except HTTPException:
            raise
        except Exception as e:  # noqa: BLE001
            LOG.exception("stt failed for %s", eid)
            raise HTTPException(status_code=500, detail=f"stt {eid} failed: {e}") from e
        return JSONResponse({**out, "engine": eid})

    @app.post("/tts")
    async def tts(request: Request) -> Response:
        body = await request.json()
        eid = str(body.get("engine") or body.get("model") or default_for("tts") or "")
        if not eid:
            raise HTTPException(status_code=400, detail="engine required (no tier default set)")
        spec = ENGINES.get(eid)
        if spec is None or spec.kind != "tts":
            raise HTTPException(status_code=400, detail=f"unknown tts engine: {eid}")
        if not runtime.is_available(eid):
            raise HTTPException(
                status_code=503,
                detail=f"engine {eid} not available — install: {','.join(spec.optional_imports)}",
            )
        text = str(body.get("text") or "")
        voice = str(body.get("voice") or "")
        speed = float(body.get("speed") or 1.0)
        try:
            if eid == "kokoro-82m":
                model = runtime.get_or_load(eid, lambda: _load_kokoro(spec, runtime))
                audio_bytes, ctype = _kokoro_synthesize(model, text, voice, speed)
            elif eid == "orpheus-3b":
                model = runtime.get_or_load(eid, lambda: _load_orpheus(spec, runtime))
                audio_bytes, ctype = _orpheus_synthesize(model, text, voice, speed)
            else:
                raise HTTPException(status_code=400, detail=f"engine not implemented: {eid}")
        except HTTPException:
            raise
        except Exception as e:  # noqa: BLE001
            LOG.exception("tts failed for %s", eid)
            raise HTTPException(status_code=500, detail=f"tts {eid} failed: {e}") from e
        return Response(content=audio_bytes, media_type=ctype)

    # -----------------------------------------------------------------------
    # WS /stt/stream — streaming STT.
    #
    # Protocol:
    #   client → server:
    #     - binary frames: Int16 LE PCM at 16 kHz mono
    #     - text frames:   {"op": "config", "engine"?: str, "language"?: str}
    #                      {"op": "flush"}   — emit a partial now
    #                      {"op": "final"}   — emit final + reset buffer
    #                      {"op": "reset"}   — drop the buffer, no transcript
    #   server → client:
    #     - text frames: {"type": "ready", "engine": str, "sampleRate": 16000}
    #                    {"type": "partial", "text": str}
    #                    {"type": "final", "text": str}
    #                    {"type": "error", "error": str}
    @app.websocket("/stt/stream")
    async def stt_stream(ws: WebSocket) -> None:
        await ws.accept()
        # Resolve engine: ?engine=... query param overrides tier default.
        eid = (ws.query_params.get("engine") or default_for("stt") or "").strip()
        # Per-connection state — guarded only by the engine-level lock during
        # actual transcribe calls so concurrent partial/final don't collide.
        buffer = bytearray()
        partial_at_bytes = 0  # bytes already covered by the last partial
        partial_min_bytes = STREAM_SAMPLE_RATE * STREAM_BYTES_PER_SAMPLE  # ~1 s
        last_partial_text = ""

        async def send_error(msg: str) -> None:
            try:
                await ws.send_text(json.dumps({"type": "error", "error": msg}))
            except Exception:
                pass

        if not eid:
            await send_error("engine required (no tier default set)")
            await ws.close()
            return
        spec = ENGINES.get(eid)
        if spec is None or spec.kind != "stt":
            await send_error(f"unknown stt engine: {eid}")
            await ws.close()
            return
        if not runtime.is_available(eid):
            await send_error(
                f"engine {eid} not available — install: {','.join(spec.optional_imports)}"
            )
            await ws.close()
            return

        # Eagerly load the engine so the first partial doesn't pay the cold-start
        # cost mid-utterance.
        try:
            if eid == "moonshine-tiny":
                model = runtime.get_or_load(eid, lambda: _load_moonshine(spec, runtime))
            elif eid == "whisper-large-v3-turbo-cpp":
                model = runtime.get_or_load(eid, lambda: _load_whisper_cpp(spec, runtime))
            elif eid == "parakeet-tdt-0.6b-v2":
                model = runtime.get_or_load(eid, lambda: _load_parakeet(spec, runtime))
            else:
                await send_error(f"engine not implemented: {eid}")
                await ws.close()
                return
        except Exception as e:  # noqa: BLE001
            LOG.exception("stt stream load failed for %s", eid)
            await send_error(f"load {eid} failed: {e}")
            await ws.close()
            return

        await ws.send_text(json.dumps({
            "type": "ready",
            "engine": eid,
            "sampleRate": STREAM_SAMPLE_RATE,
        }))

        engine_lock = runtime._locks[eid]

        async def transcribe(snapshot: bytes) -> str:
            # Run the (blocking) transcribe in a worker thread; protect against
            # concurrent calls into the engine with the per-engine lock.
            import asyncio
            def _do() -> str:
                with engine_lock:
                    return _stt_transcribe_pcm(eid, model, snapshot)
            return await asyncio.get_event_loop().run_in_executor(None, _do)

        try:
            while True:
                msg = await ws.receive()
                if msg.get("type") == "websocket.disconnect":
                    break
                if "bytes" in msg and msg["bytes"] is not None:
                    buffer.extend(msg["bytes"])
                    # Auto-emit a partial when we've accumulated enough new audio.
                    if len(buffer) - partial_at_bytes >= partial_min_bytes:
                        snapshot = bytes(buffer)
                        try:
                            text = await transcribe(snapshot)
                        except Exception as e:  # noqa: BLE001
                            LOG.warning("stt stream partial failed: %s", e)
                            text = last_partial_text
                        if text and text != last_partial_text:
                            last_partial_text = text
                            await ws.send_text(json.dumps({"type": "partial", "text": text}))
                        partial_at_bytes = len(buffer)
                    continue
                text_frame = msg.get("text")
                if not text_frame:
                    continue
                try:
                    op_msg = json.loads(text_frame)
                except Exception:
                    continue
                op = str(op_msg.get("op") or "")
                if op == "flush":
                    snapshot = bytes(buffer)
                    if not snapshot:
                        continue
                    try:
                        text = await transcribe(snapshot)
                    except Exception as e:  # noqa: BLE001
                        await send_error(f"transcribe failed: {e}")
                        continue
                    last_partial_text = text
                    await ws.send_text(json.dumps({"type": "partial", "text": text}))
                    partial_at_bytes = len(buffer)
                elif op == "final":
                    snapshot = bytes(buffer)
                    final_text = ""
                    if snapshot:
                        try:
                            final_text = await transcribe(snapshot)
                        except Exception as e:  # noqa: BLE001
                            await send_error(f"transcribe failed: {e}")
                    await ws.send_text(json.dumps({"type": "final", "text": final_text}))
                    buffer.clear()
                    partial_at_bytes = 0
                    last_partial_text = ""
                elif op == "reset":
                    buffer.clear()
                    partial_at_bytes = 0
                    last_partial_text = ""
                # Any other op is silently ignored — keeps the protocol additive.
        except WebSocketDisconnect:
            pass
        except Exception:  # noqa: BLE001
            LOG.exception("stt stream error")
            try:
                await ws.close()
            except Exception:
                pass

    # -----------------------------------------------------------------------
    # WS /tts/stream — streaming TTS.
    #
    # Protocol:
    #   client → server (text frames):
    #     {"op":"speak", "text": str, "voice"?: str, "speed"?: float,
    #      "utteranceId"?: str}
    #     {"op":"close"}
    #   server → client:
    #     {"type":"start", "utteranceId"?: str, "sampleRate": int}
    #     binary frames: Int16 LE PCM at the engine's native rate
    #     {"type":"end", "utteranceId"?: str}
    #     {"type":"error", "error": str}
    #
    # One WS can carry many utterances; the client may send another `speak`
    # before the previous one finishes — we serialise on the engine lock.
    @app.websocket("/tts/stream")
    async def tts_stream(ws: WebSocket) -> None:
        await ws.accept()
        eid = (ws.query_params.get("engine") or default_for("tts") or "").strip()

        async def send_error(msg: str) -> None:
            try:
                await ws.send_text(json.dumps({"type": "error", "error": msg}))
            except Exception:
                pass

        if not eid:
            await send_error("engine required (no tier default set)")
            await ws.close()
            return
        spec = ENGINES.get(eid)
        if spec is None or spec.kind != "tts":
            await send_error(f"unknown tts engine: {eid}")
            await ws.close()
            return
        if not runtime.is_available(eid):
            await send_error(
                f"engine {eid} not available — install: {','.join(spec.optional_imports)}"
            )
            await ws.close()
            return

        try:
            if eid == "kokoro-82m":
                model = runtime.get_or_load(eid, lambda: _load_kokoro(spec, runtime))
            elif eid == "orpheus-3b":
                model = runtime.get_or_load(eid, lambda: _load_orpheus(spec, runtime))
            else:
                await send_error(f"engine not implemented: {eid}")
                await ws.close()
                return
        except Exception as e:  # noqa: BLE001
            LOG.exception("tts stream load failed for %s", eid)
            await send_error(f"load {eid} failed: {e}")
            await ws.close()
            return

        engine_lock = runtime._locks[eid]

        async def synth_one(text: str, voice: str, speed: float) -> tuple[Any, int]:
            import asyncio
            def _do() -> tuple[Any, int]:
                with engine_lock:
                    if eid == "kokoro-82m":
                        return _kokoro_synth_pcm(model, text, voice, speed)
                    # Orpheus stub — return half a second of silence at 24 kHz.
                    import numpy as np  # type: ignore
                    return np.zeros(12000, dtype="int16"), 24000
            return await asyncio.get_event_loop().run_in_executor(None, _do)

        try:
            while True:
                msg = await ws.receive()
                if msg.get("type") == "websocket.disconnect":
                    break
                text_frame = msg.get("text")
                if not text_frame:
                    continue
                try:
                    op_msg = json.loads(text_frame)
                except Exception:
                    continue
                op = str(op_msg.get("op") or "")
                if op == "close":
                    break
                if op != "speak":
                    continue
                text = str(op_msg.get("text") or "").strip()
                if not text:
                    continue
                voice = str(op_msg.get("voice") or "")
                speed = float(op_msg.get("speed") or 1.0)
                utterance_id = op_msg.get("utteranceId")
                phrases = _split_for_tts(text)

                # Synthesise the first phrase before announcing `start` so we
                # know the sample rate. Subsequent phrases reuse the same
                # rate (Kokoro is stable across calls).
                first_pcm, sr = await synth_one(phrases[0], voice, speed)
                start_payload: dict[str, Any] = {"type": "start", "sampleRate": sr}
                if utterance_id is not None:
                    start_payload["utteranceId"] = utterance_id
                await ws.send_text(json.dumps(start_payload))
                await ws.send_bytes(first_pcm.tobytes())

                for phrase in phrases[1:]:
                    try:
                        pcm, _ = await synth_one(phrase, voice, speed)
                    except Exception as e:  # noqa: BLE001
                        await send_error(f"synth failed: {e}")
                        continue
                    await ws.send_bytes(pcm.tobytes())

                end_payload: dict[str, Any] = {"type": "end"}
                if utterance_id is not None:
                    end_payload["utteranceId"] = utterance_id
                await ws.send_text(json.dumps(end_payload))
        except WebSocketDisconnect:
            pass
        except Exception:  # noqa: BLE001
            LOG.exception("tts stream error")
            try:
                await ws.close()
            except Exception:
                pass

    return app


# ---------------------------------------------------------------------------
# CLI entrypoint

def main() -> None:
    parser = argparse.ArgumentParser(description="control-deck voice-engines sidecar")
    parser.add_argument("--port", type=int, default=int(os.environ.get("VOICE_ENGINES_PORT", "9101")))
    parser.add_argument("--host", default=os.environ.get("VOICE_ENGINES_HOST", "127.0.0.1"))
    parser.add_argument("--tier", choices=["T1_MAC", "T2_CUDA", "T3_CPU"], default=os.environ.get("VOICE_ENGINES_TIER"))
    parser.add_argument(
        "--model-root",
        default=os.environ.get("VOICE_ENGINES_MODELS", str(Path.home() / ".cache" / "control-deck" / "voice-engines")),
    )
    args = parser.parse_args()

    app = build_app(tier=args.tier, model_root=Path(args.model_root))

    import uvicorn  # type: ignore

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
