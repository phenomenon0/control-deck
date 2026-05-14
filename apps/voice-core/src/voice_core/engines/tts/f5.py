"""
F5-TTS — premium-quality zero-shot voice cloning TTS.

Loads on CUDA when available. Single-utterance synth (no native streaming);
returns Int16 LE PCM at 24 kHz.

The reference audio + transcript is what F5 conditions on for voice
identity. We ship the wheel's built-in English reference so the engine
works out-of-the-box. To use a custom voice, pass `voice` as a path to a
short (3-15 s) WAV; an empty `ref_text` lets F5 auto-transcribe via its
internal Whisper.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

import numpy as np

from voice_core.engines.base import EngineMeta, TtsEngine

LOG = logging.getLogger("voice-core.tts.f5")

# Bundled reference audio + transcript — F5 wheel ships this for English.
_DEFAULT_REF_TEXT = "Some call me nature, others call me mother nature."


def _bundled_ref_audio() -> str | None:
    try:
        import f5_tts  # type: ignore
    except Exception:  # noqa: BLE001
        return None
    # f5_tts is a namespace package (`__file__` is None); use __path__[0].
    p = Path(next(iter(f5_tts.__path__))) / "infer" / "examples" / "basic" / "basic_ref_en.wav"
    return str(p) if p.exists() else None


class F5TtsEngine(TtsEngine):
    meta = EngineMeta(
        id="f5-tts",
        label="F5-TTS (zero-shot voice cloning)",
        kind="tts",
        size_mb=1400,
        note="MIT-licensed flow-matching TTS — natural prosody, voice cloning from 3-15 s ref.",
    )
    sample_rate = 24_000

    def __init__(self, settings):
        self._settings = settings
        self._model = None
        self._loaded = False
        self._ref_audio: str | None = None
        self._ref_text: str = _DEFAULT_REF_TEXT

    def available(self) -> bool:
        try:
            import f5_tts  # noqa: F401
        except Exception:  # noqa: BLE001
            return False
        return _bundled_ref_audio() is not None

    def load(self) -> None:
        if self._loaded:
            return
        from f5_tts.api import F5TTS  # type: ignore

        device = os.environ.get("VOICE_CORE_F5_DEVICE")
        if device is None:
            try:
                import torch  # type: ignore
                device = "cuda" if torch.cuda.is_available() else "cpu"
            except Exception:  # noqa: BLE001
                device = "cpu"

        model_name = os.environ.get("VOICE_CORE_F5_MODEL", "F5TTS_v1_Base")
        self._model = F5TTS(model=model_name, device=device)
        self._ref_audio = _bundled_ref_audio()
        ref_env = os.environ.get("VOICE_CORE_F5_REF_AUDIO")
        text_env = os.environ.get("VOICE_CORE_F5_REF_TEXT")
        if ref_env and Path(ref_env).exists():
            self._ref_audio = ref_env
            self._ref_text = text_env or ""  # empty → auto-transcribe inside f5
        self._loaded = True
        LOG.info("f5-tts loaded model=%s device=%s ref=%s", model_name, device, self._ref_audio)

    def synthesise(
        self, text: str, voice: str | None = None, speed: float = 1.0
    ) -> bytes:
        self.load()
        ref_audio = voice if (voice and Path(voice).exists()) else self._ref_audio
        # If caller supplied a custom ref audio, empty ref_text triggers auto-transcribe.
        ref_text = self._ref_text if ref_audio == self._ref_audio else ""
        wav, sr, _ = self._model.infer(
            ref_file=ref_audio,
            ref_text=ref_text,
            gen_text=text,
            speed=speed,
            show_info=lambda *_a, **_k: None,
            progress=None,
        )
        # F5 returns float32 in [-1, 1] at 24 kHz. Resample if it deviates.
        audio = np.asarray(wav, dtype=np.float32)
        if sr != self.sample_rate:
            from voice_core import audio_utils
            audio = audio_utils.resample(audio, sr, self.sample_rate)
        pcm = np.clip(audio * 32767.0, -32768, 32767).astype(np.int16)
        return pcm.tobytes()


def factory(settings) -> F5TtsEngine:
    return F5TtsEngine(settings)
