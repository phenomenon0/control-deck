"""
sherpa-onnx TTS — fallback voice when Kokoro is missing weights.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Iterator
from pathlib import Path

import numpy as np

from voice_core.engines.base import EngineMeta, StreamingTts

LOG = logging.getLogger("voice-core.tts.sherpa")


def _model_dir(settings) -> Path:
    override = os.environ.get("VOICE_CORE_SHERPA_TTS_DIR")
    if override:
        return Path(override).expanduser()
    return settings.models_dir / "sherpa-tts"


class SherpaTtsEngine(StreamingTts):
    meta = EngineMeta(
        id="sherpa-onnx-tts",
        label="sherpa-onnx TTS (VITS)",
        kind="tts",
        size_mb=140,
        note="Fallback TTS — runs on CPU.",
    )
    sample_rate = 22_050

    def __init__(self, settings):
        self._settings = settings
        self._tts = None
        self._loaded = False

    def available(self) -> bool:
        try:
            import sherpa_onnx  # noqa: F401
        except Exception:  # noqa: BLE001
            return False
        return _model_dir(self._settings).exists()

    def load(self) -> None:
        if self._loaded:
            return
        import sherpa_onnx  # type: ignore

        model_dir = _model_dir(self._settings)
        model = next(model_dir.glob("*.onnx"), None)
        tokens = model_dir / "tokens.txt"
        lexicon = next(model_dir.glob("lexicon*.txt"), None)
        # Piper VITS models phonemize via eSpeak — they ship espeak-ng-data/
        # next to the .onnx and have no lexicon. sherpa-onnx requires either
        # data_dir (espeak) OR lexicon for non-character models.
        data_dir = model_dir / "espeak-ng-data"
        if model is None or not tokens.exists():
            raise RuntimeError(f"sherpa-tts: missing model.onnx/tokens.txt under {model_dir}")
        cfg = sherpa_onnx.OfflineTtsConfig(
            model=sherpa_onnx.OfflineTtsModelConfig(
                vits=sherpa_onnx.OfflineTtsVitsModelConfig(
                    model=str(model),
                    tokens=str(tokens),
                    lexicon=str(lexicon) if lexicon else "",
                    data_dir=str(data_dir) if data_dir.is_dir() else "",
                ),
                num_threads=2,
            ),
        )
        self._tts = sherpa_onnx.OfflineTts(cfg)
        self.sample_rate = self._tts.sample_rate
        self._loaded = True
        LOG.info("sherpa-onnx tts loaded sample_rate=%d", self.sample_rate)

    def stream(
        self, text: str, voice: str | None = None, speed: float = 1.0
    ) -> Iterator[bytes]:
        self.load()
        speaker_id = 0
        try:
            speaker_id = int(voice) if voice is not None else 0
        except ValueError:
            speaker_id = 0
        result = self._tts.generate(text, sid=speaker_id, speed=float(speed))
        audio = np.asarray(result.samples, dtype=np.float32)
        clipped = np.clip(audio, -1.0, 1.0)
        pcm = (clipped * 32767.0).astype(np.int16).tobytes()
        return iter([pcm])


def factory(settings) -> SherpaTtsEngine:
    return SherpaTtsEngine(settings)
