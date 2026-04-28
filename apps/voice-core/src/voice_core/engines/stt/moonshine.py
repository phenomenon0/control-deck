"""
Moonshine-Tiny — ONNX, CPU-streaming-friendly.

Model is batch at the engine layer. We expose both `transcribe` (one-shot
batch) and `StreamingSttSession` that runs a partial transcribe over a rolling
buffer every ~700 ms — same trick as the legacy sidecar.
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

LOG = logging.getLogger("voice-core.stt.moonshine")

PARTIAL_INTERVAL_S = 0.7
SAMPLE_RATE = 16_000
MAX_BUFFER_S = 30.0


def _load_model(models_dir):
    from moonshine_onnx import MoonshineOnnxModel  # type: ignore

    target = models_dir / "moonshine-tiny"
    if any(target.rglob("*.onnx")):
        return MoonshineOnnxModel(models_dir=str(target))
    return MoonshineOnnxModel(model_name="moonshine/tiny")


def _decode(model, audio: np.ndarray) -> str:
    from moonshine_onnx import load_tokenizer  # type: ignore

    if len(audio) == 0:
        return ""
    tokens = model.generate(audio[None, :].astype("float32"))
    tokenizer = load_tokenizer()
    return str(tokenizer.decode_batch(tokens)[0] if tokens is not None else "").strip()


class MoonshineEngine(StreamingStt):
    meta = EngineMeta(
        id="moonshine-tiny",
        label="Moonshine Tiny (ONNX)",
        kind="stt",
        size_mb=200,
        note="Apache-2.0 streaming-friendly STT — ~60 ms first partial on laptop CPUs.",
    )

    def __init__(self, settings):
        self._settings = settings
        self._model = None
        self._loaded = False

    def available(self) -> bool:
        try:
            import moonshine_onnx  # noqa: F401
        except Exception:  # noqa: BLE001
            return False
        return True

    def load(self) -> None:
        if self._loaded:
            return
        self._model = _load_model(self._settings.models_dir)
        self._loaded = True
        LOG.info("moonshine-tiny loaded")

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
        return _MoonshineSession(self._model)


class _MoonshineSession(StreamingSttSession):
    def __init__(self, model):
        self._model = model
        self._buf = bytearray()
        self._last_partial_at = 0.0
        self._last_partial_text = ""

    def push(self, audio_pcm16: bytes) -> Iterator[dict[str, Any]]:
        self._buf.extend(audio_pcm16)
        # Cap the running buffer so we don't OOM on long, never-flushed streams.
        max_bytes = int(MAX_BUFFER_S * SAMPLE_RATE * 2)
        if len(self._buf) > max_bytes:
            del self._buf[: len(self._buf) - max_bytes]

        now = time.monotonic()
        if now - self._last_partial_at < PARTIAL_INTERVAL_S:
            return iter(())
        self._last_partial_at = now
        text = _decode(self._model, audio_utils.pcm16_to_float32(self._buf))
        if text and text != self._last_partial_text:
            self._last_partial_text = text
            return iter([{"type": "partial", "text": text}])
        return iter(())

    def flush(self) -> Iterator[dict[str, Any]]:
        text = _decode(self._model, audio_utils.pcm16_to_float32(self._buf))
        if not text:
            return iter(())
        self._last_partial_text = text
        return iter([{"type": "partial", "text": text}])

    def final(self) -> Iterator[dict[str, Any]]:
        text = _decode(self._model, audio_utils.pcm16_to_float32(self._buf))
        self.reset()
        if not text:
            return iter([{"type": "final", "text": ""}])
        return iter([{"type": "final", "text": text}])

    def reset(self) -> None:
        self._buf = bytearray()
        self._last_partial_at = 0.0
        self._last_partial_text = ""


def factory(settings) -> MoonshineEngine:
    return MoonshineEngine(settings)
