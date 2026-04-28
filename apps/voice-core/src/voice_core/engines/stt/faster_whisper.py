"""
faster-whisper — final-correction engine on CUDA tiers.

Used after the streaming ASR emits a final to upgrade the transcript to the
high-quality whisper output. Falls back to "available: false" if the wheel is
missing (T1_MAC uses pywhispercpp instead).
"""

from __future__ import annotations

import logging
from typing import Any

import numpy as np

from voice_core import audio_utils
from voice_core.engines.base import EngineMeta, SttEngine

LOG = logging.getLogger("voice-core.stt.faster-whisper")

SAMPLE_RATE = 16_000


class FasterWhisperEngine(SttEngine):
    meta = EngineMeta(
        id="faster-whisper",
        label="faster-whisper (CTranslate2)",
        kind="stt",
        note="Final-correction model on CUDA tiers — pairs with sherpa-onnx streaming.",
    )

    def __init__(self, settings):
        self._settings = settings
        self._model = None
        self._loaded = False

    def available(self) -> bool:
        try:
            import faster_whisper  # noqa: F401
        except Exception:  # noqa: BLE001
            return False
        return True

    def load(self) -> None:
        if self._loaded:
            return
        from faster_whisper import WhisperModel  # type: ignore

        # Default to "large-v3-turbo" which is the smallest big-quality model.
        # Override with VOICE_CORE_FASTER_WHISPER_MODEL.
        import os

        name = os.environ.get("VOICE_CORE_FASTER_WHISPER_MODEL", "large-v3-turbo")
        device = os.environ.get("VOICE_CORE_FASTER_WHISPER_DEVICE", "auto")
        compute_type = os.environ.get("VOICE_CORE_FASTER_WHISPER_COMPUTE", "auto")
        self._model = WhisperModel(name, device=device, compute_type=compute_type)
        self._loaded = True
        LOG.info("faster-whisper loaded model=%s device=%s", name, device)

    def transcribe(
        self, audio_pcm16: bytes, sample_rate: int, language: str | None = None
    ) -> dict[str, Any]:
        self.load()
        audio = audio_utils.pcm16_to_float32(audio_pcm16)
        audio = audio_utils.resample(audio, sample_rate, SAMPLE_RATE)
        segments, info = self._model.transcribe(audio, language=language)
        parts = []
        for s in segments:
            parts.append(s.text.strip())
        return {
            "text": " ".join(parts).strip(),
            "language": getattr(info, "language", None),
            "duration": getattr(info, "duration", None),
        }


def factory(settings) -> FasterWhisperEngine:
    return FasterWhisperEngine(settings)
