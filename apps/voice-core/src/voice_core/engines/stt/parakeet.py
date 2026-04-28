"""
NVIDIA Parakeet TDT 0.6B v2 (NeMo) — CUDA tier default.
"""

from __future__ import annotations

import logging
import os
import tempfile
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

LOG = logging.getLogger("voice-core.stt.parakeet")

SAMPLE_RATE = 16_000
PARTIAL_INTERVAL_S = 0.8
MAX_BUFFER_S = 30.0


def _load_model(models_dir):
    from nemo.collections.asr.models import ASRModel  # type: ignore

    target = models_dir / "parakeet-tdt-0.6b-v2"
    nemo_file = next(target.rglob("*.nemo"), None)
    if nemo_file is None:
        return ASRModel.from_pretrained("nvidia/parakeet-tdt-0.6b-v2")
    return ASRModel.restore_from(str(nemo_file))


def _decode(model, audio: np.ndarray) -> str:
    if len(audio) == 0:
        return ""
    try:
        result = model.transcribe([audio])
    except Exception:  # noqa: BLE001
        # Fall back to a temp WAV path; older NeMo versions only accept paths.
        import io as _io

        import soundfile as sf  # type: ignore

        buf = _io.BytesIO()
        sf.write(buf, audio, SAMPLE_RATE, format="WAV", subtype="PCM_16")
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


class ParakeetEngine(StreamingStt):
    meta = EngineMeta(
        id="parakeet-tdt-0.6b-v2",
        label="NVIDIA Parakeet TDT 0.6B v2",
        kind="stt",
        size_mb=1300,
        note="Open ASR Leaderboard #1 — ~1.5 GB VRAM, RTF ≈ 0.06 on consumer NVIDIA.",
    )

    def __init__(self, settings):
        self._settings = settings
        self._model = None
        self._loaded = False

    def available(self) -> bool:
        try:
            import nemo.collections.asr  # noqa: F401
        except Exception:  # noqa: BLE001
            return False
        return True

    def load(self) -> None:
        if self._loaded:
            return
        self._model = _load_model(self._settings.models_dir)
        self._loaded = True
        LOG.info("parakeet loaded")

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
        return _ParakeetSession(self._model)


class _ParakeetSession(StreamingSttSession):
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


def factory(settings) -> ParakeetEngine:
    return ParakeetEngine(settings)
