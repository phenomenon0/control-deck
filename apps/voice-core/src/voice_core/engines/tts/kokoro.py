"""
Kokoro 82M (ONNX) — default low-latency TTS across every tier.

Splits the input text into phrases and emits one Int16 LE PCM chunk per
phrase. The deck's StreamingTtsClient queues each chunk into a single
AudioBuffer pipeline, so first-audio-out lands within the synth time of the
shortest phrase.

Weights ship as two release files: `kokoro-v1.0.onnx` + `voices-v1.0.bin`. We
auto-fetch them into `<models_dir>/kokoro-82m/` if they're missing.
"""

from __future__ import annotations

import logging
import os
import re
import time
import urllib.request
from collections.abc import Iterator
from pathlib import Path

import numpy as np

from voice_core.engines.base import EngineMeta, StreamingTts

LOG = logging.getLogger("voice-core.tts.kokoro")

_RELEASE_BASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
_RELEASE_FILES = ("kokoro-v1.0.onnx", "voices-v1.0.bin")

_PHRASE_SPLIT = re.compile(r"(?<=[.!?。])\s+|(?<=[,;:])\s+|\n{2,}")


def _ensure_release_files(target: Path) -> tuple[Path, Path]:
    target.mkdir(parents=True, exist_ok=True)
    paths = []
    for name in _RELEASE_FILES:
        dest = target / name
        if not dest.exists() or dest.stat().st_size == 0:
            url = f"{_RELEASE_BASE}/{name}"
            LOG.info("kokoro: fetching %s -> %s", url, dest)
            urllib.request.urlretrieve(url, dest)  # noqa: S310 (controlled URL)
        paths.append(dest)
    return paths[0], paths[1]


def _split_phrases(text: str) -> list[str]:
    parts = [p.strip() for p in _PHRASE_SPLIT.split(text or "") if p and p.strip()]
    return parts or ([text.strip()] if text and text.strip() else [])


class KokoroEngine(StreamingTts):
    meta = EngineMeta(
        id="kokoro-82m",
        label="Kokoro 82M (ONNX)",
        kind="tts",
        size_mb=330,
        note="Apache-2.0 — 50+ baked voices, ~150 ms first chunk on Apple Silicon.",
    )
    sample_rate = 24_000

    def __init__(self, settings):
        self._settings = settings
        self._model = None
        self._loaded = False
        self._default_voice = "af_sky"

    def available(self) -> bool:
        try:
            import kokoro_onnx  # noqa: F401
        except Exception:  # noqa: BLE001
            return False
        return True

    def load(self) -> None:
        if self._loaded:
            return
        # kokoro-onnx only picks an accelerator EP if ONNX_PROVIDER is set
        # explicitly — its `find_spec("onnxruntime-gpu")` check fails because
        # the importable module name is `onnxruntime`, not `onnxruntime-gpu`.
        # Prefer CUDA on Linux/Windows; CoreML on macOS (Apple Silicon ANE);
        # fall back to CPU silently. Honour any pre-set value so operators can
        # override per-host without code changes.
        import sys
        import onnxruntime as _ort
        if not os.environ.get("ONNX_PROVIDER"):
            available = _ort.get_available_providers()
            if "CUDAExecutionProvider" in available:
                os.environ["ONNX_PROVIDER"] = "CUDAExecutionProvider"
            elif sys.platform == "darwin" and "CoreMLExecutionProvider" in available:
                os.environ["ONNX_PROVIDER"] = "CoreMLExecutionProvider"
        import kokoro_onnx  # type: ignore

        target = self._settings.models_dir / "kokoro-82m"
        model_path, voices_path = _ensure_release_files(target)
        self._model = kokoro_onnx.Kokoro(str(model_path), str(voices_path))
        self._loaded = True
        LOG.info("kokoro-82m loaded from %s provider=%s", target, os.environ.get("ONNX_PROVIDER", "CPU"))

    def unload(self) -> None:
        if not self._loaded:
            return
        self._model = None
        self._loaded = False
        LOG.info("kokoro-82m unloaded")

    def list_voices(self) -> list[dict[str, str]]:
        """Return the baked voice catalogue. Kokoro ships ~50 voices in voices-v1.0.bin."""
        try:
            self.load()
        except Exception:  # noqa: BLE001 — surface empty list rather than crash
            return []
        # kokoro_onnx's Kokoro stores voices in self._model.voices as {id: ndarray}.
        names = sorted(getattr(self._model, "voices", {}).keys())
        out = []
        for name in names:
            # Format: <lang/gender>_<name>, e.g. af_sky, am_michael, bf_emma.
            lang = name.split("_", 1)[0] if "_" in name else None
            out.append({"id": name, "name": name, "lang": lang or ""})
        return out

    def stream(
        self,
        text: str,
        voice: str | None = None,
        speed: float = 1.0,
        *,
        enable_timing: bool = False,
    ) -> Iterator:
        self.load()
        chosen_voice = voice or self._default_voice
        phrases = _split_phrases(text)
        for idx, phrase in enumerate(phrases):
            if enable_timing:
                t0 = time.perf_counter()
            audio, sr = self._model.create(phrase, voice=chosen_voice, speed=float(speed), lang="en-us")
            if sr != self.sample_rate:
                self.sample_rate = int(sr)
            arr = np.asarray(audio)
            if arr.dtype != np.int16:
                clipped = np.clip(arr.astype("float32"), -1.0, 1.0)
                pcm = (clipped * 32767.0).astype("int16")
            else:
                pcm = arr
            if enable_timing:
                elapsed_ms = (time.perf_counter() - t0) * 1000.0
                yield {
                    "type": "timing",
                    "phase": "tts.synth_per_phrase",
                    "ms": elapsed_ms,
                    "meta": {
                        "engine": "kokoro-82m",
                        "voice": chosen_voice,
                        "phrase_index": idx,
                        "phrase_chars": len(phrase),
                        "audio_samples": int(arr.size),
                    },
                }
            yield pcm.tobytes()


def factory(settings) -> KokoroEngine:
    return KokoroEngine(settings)
