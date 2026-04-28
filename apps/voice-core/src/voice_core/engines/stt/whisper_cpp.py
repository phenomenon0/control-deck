"""
whisper.cpp via pywhispercpp.

Mac default — uses CoreML on Apple Silicon when ggml-*.bin sits next to a
matching mlmodelc bundle. Loads any ggml-*.bin we find under
`<models_dir>/whisper-large-v3-turbo-cpp/`.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Iterator
from typing import Any

import numpy as np

from voice_core import audio_utils
from voice_core.engines.base import (
    EngineMeta,
    StreamingStt,
    StreamingSttSession,
)

LOG = logging.getLogger("voice-core.stt.whisper-cpp")

SAMPLE_RATE = 16_000
PARTIAL_INTERVAL_S = 1.0
MAX_BUFFER_S = 30.0


def _load_model(models_dir):
    from pywhispercpp.model import Model  # type: ignore

    target = models_dir / "whisper-large-v3-turbo-cpp"
    candidate = next(target.rglob("ggml-*.bin"), None) or next(target.rglob("*.bin"), None)
    if candidate is None:
        raise RuntimeError(f"whisper.cpp: no ggml-*.bin under {target}")
    return Model(str(candidate))


def _decode(model, audio: np.ndarray) -> str:
    if len(audio) == 0:
        return ""
    segs = model.transcribe(audio)
    return " ".join(s.text.strip() for s in segs).strip()


class WhisperCppEngine(StreamingStt):
    meta = EngineMeta(
        id="whisper-large-v3-turbo-cpp",
        label="Whisper large-v3-turbo (whisper.cpp / CoreML)",
        kind="stt",
        size_mb=1600,
        note="ANE-accelerated on Apple Silicon. Used as final-correction on T1.",
    )

    def __init__(self, settings):
        self._settings = settings
        self._model = None
        self._loaded = False

    def available(self) -> bool:
        try:
            import pywhispercpp  # noqa: F401
        except Exception:  # noqa: BLE001
            return False
        return True

    def load(self) -> None:
        if self._loaded:
            return
        self._model = _load_model(self._settings.models_dir)
        self._loaded = True
        LOG.info("whisper.cpp loaded")

    def transcribe(
        self, audio_pcm16: bytes, sample_rate: int, language: str | None = None
    ) -> dict[str, Any]:
        self.load()
        audio = audio_utils.pcm16_to_float32(audio_pcm16)
        audio = audio_utils.resample(audio, sample_rate, SAMPLE_RATE)
        text = _decode(self._model, audio)
        return {"text": text, "duration": len(audio) / SAMPLE_RATE}

    def open(self, language: str | None = None) -> StreamingSttSession:
        self.load()
        return _WhisperCppSession(self._model)


class _WhisperCppSession(StreamingSttSession):
    def __init__(self, model):
        self._model = model
        self._buf = bytearray()
        self._last_partial_at = 0.0
        self._last_text = ""

    def push(self, audio_pcm16: bytes) -> Iterator[dict[str, Any]]:
        self._buf.extend(audio_pcm16)
        max_bytes = int(MAX_BUFFER_S * SAMPLE_RATE * 2)
        if len(self._buf) > max_bytes:
            del self._buf[: len(self._buf) - max_bytes]

        now = time.monotonic()
        if now - self._last_partial_at < PARTIAL_INTERVAL_S:
            return iter(())
        self._last_partial_at = now
        text = _decode(self._model, audio_utils.pcm16_to_float32(self._buf))
        if text and text != self._last_text:
            self._last_text = text
            return iter([{"type": "partial", "text": text}])
        return iter(())

    def flush(self) -> Iterator[dict[str, Any]]:
        text = _decode(self._model, audio_utils.pcm16_to_float32(self._buf))
        if not text:
            return iter(())
        self._last_text = text
        return iter([{"type": "partial", "text": text}])

    def final(self) -> Iterator[dict[str, Any]]:
        text = _decode(self._model, audio_utils.pcm16_to_float32(self._buf))
        self.reset()
        return iter([{"type": "final", "text": text or ""}])

    def reset(self) -> None:
        self._buf = bytearray()
        self._last_partial_at = 0.0
        self._last_text = ""


def factory(settings) -> WhisperCppEngine:
    return WhisperCppEngine(settings)
