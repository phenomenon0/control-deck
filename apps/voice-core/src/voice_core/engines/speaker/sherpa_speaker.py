"""
Speaker embedding via sherpa-onnx (3D-Speaker).

Both `embed` (used by /speaker/enroll) and the cosine helper inherited from
`SpeakerEngine` (used by /speaker/verify) live here.

Model dir: `<models_dir>/speaker/3dspeaker_*.onnx`. Override with
`VOICE_CORE_SPEAKER_PATH`.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

import numpy as np

from voice_core import audio_utils
from voice_core.engines.base import EngineMeta, SpeakerEngine

LOG = logging.getLogger("voice-core.speaker.sherpa")

SAMPLE_RATE = 16_000


def _model_path(settings) -> Path:
    override = os.environ.get("VOICE_CORE_SPEAKER_PATH")
    if override:
        return Path(override).expanduser()
    target = settings.models_dir / "speaker"
    candidate = next(target.glob("*.onnx"), None) if target.exists() else None
    if candidate is None:
        return target / "3dspeaker.onnx"
    return candidate


class SherpaSpeakerEngine(SpeakerEngine):
    meta = EngineMeta(
        id="sherpa-onnx-speaker",
        label="sherpa-onnx Speaker (3D-Speaker)",
        kind="speaker",
        size_mb=80,
        note="Speaker embedding for enroll/verify. CPU-friendly.",
    )

    def __init__(self, settings):
        self._settings = settings
        self._extractor = None
        self._loaded = False

    def available(self) -> bool:
        try:
            import sherpa_onnx  # noqa: F401
        except Exception:  # noqa: BLE001
            return False
        return _model_path(self._settings).exists()

    def load(self) -> None:
        if self._loaded:
            return
        import sherpa_onnx  # type: ignore

        config = sherpa_onnx.SpeakerEmbeddingExtractorConfig(
            model=str(_model_path(self._settings)),
            num_threads=1,
        )
        self._extractor = sherpa_onnx.SpeakerEmbeddingExtractor(config)
        self._loaded = True
        LOG.info("sherpa-onnx speaker extractor loaded")

    def embed(self, audio_pcm16: bytes, sample_rate: int) -> np.ndarray:
        self.load()
        audio = audio_utils.pcm16_to_float32(audio_pcm16)
        audio = audio_utils.resample(audio, sample_rate, SAMPLE_RATE)
        stream = self._extractor.create_stream()
        stream.accept_waveform(SAMPLE_RATE, audio)
        stream.input_finished()
        embedding = self._extractor.compute(stream)
        return np.asarray(embedding, dtype=np.float32)


def factory(settings) -> SherpaSpeakerEngine:
    return SherpaSpeakerEngine(settings)
