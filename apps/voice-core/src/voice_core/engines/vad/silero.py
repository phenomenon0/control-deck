"""
Silero VAD via sherpa-onnx.

Frame-by-frame voice activity detection with hangover. Emits speech-start /
speech-end events; the Next/Electron client uses these to drive the FSM
arming → listening → transcribing transitions.

Model dir: `<models_dir>/silero-vad/silero_vad.onnx`. Override with
`VOICE_CORE_SILERO_VAD_PATH`.
"""

from __future__ import annotations

import logging
import os
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import numpy as np

from voice_core import audio_utils
from voice_core.engines.base import EngineMeta, VadEngine, VadSession

LOG = logging.getLogger("voice-core.vad.silero")

SAMPLE_RATE = 16_000
WINDOW = 512  # silero v5 uses 512 samples / 32 ms per inference


def _model_path(settings) -> Path:
    override = os.environ.get("VOICE_CORE_SILERO_VAD_PATH")
    if override:
        return Path(override).expanduser()
    return settings.models_dir / "silero-vad" / "silero_vad.onnx"


class SileroVadEngine(VadEngine):
    meta = EngineMeta(
        id="silero",
        label="Silero VAD (sherpa-onnx)",
        kind="vad",
        size_mb=2,
        note="MIT-licensed — runs on CPU at <0.1 ms / frame.",
    )

    def __init__(self, settings):
        self._settings = settings
        self._vad = None
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

        config = sherpa_onnx.VadModelConfig(
            silero_vad=sherpa_onnx.SileroVadModelConfig(
                model=str(_model_path(self._settings)),
                threshold=0.5,
                min_silence_duration=0.25,
                min_speech_duration=0.10,
                window_size=WINDOW,
            ),
            sample_rate=SAMPLE_RATE,
            num_threads=1,
        )
        self._vad_config = config
        self._sherpa_onnx = sherpa_onnx
        self._loaded = True
        LOG.info("silero VAD model staged")

    def open(self, *, threshold: float = 0.5) -> VadSession:
        self.load()
        # Each connection gets its own VAD instance so threshold tweaks don't
        # leak between callers.
        cfg = self._sherpa_onnx.VadModelConfig(
            silero_vad=self._sherpa_onnx.SileroVadModelConfig(
                model=str(_model_path(self._settings)),
                threshold=float(threshold),
                min_silence_duration=0.25,
                min_speech_duration=0.10,
                window_size=WINDOW,
            ),
            sample_rate=SAMPLE_RATE,
            num_threads=1,
        )
        vad = self._sherpa_onnx.VoiceActivityDetector(cfg, buffer_size_in_seconds=30.0)
        return _SileroSession(vad)


class _SileroSession(VadSession):
    def __init__(self, vad):
        self._vad = vad
        self._buf = np.zeros(0, dtype=np.float32)
        self._speaking = False
        self._speech_started_at = 0.0

    def push(self, audio_pcm16: bytes) -> Iterator[dict[str, Any]]:
        if not audio_pcm16:
            return iter(())
        new = audio_utils.pcm16_to_float32(audio_pcm16)
        self._buf = np.concatenate([self._buf, new])
        events: list[dict[str, Any]] = []

        # Run as many WINDOW-sized frames as we can fit.
        while len(self._buf) >= WINDOW:
            frame = self._buf[:WINDOW]
            self._buf = self._buf[WINDOW:]
            self._vad.accept_waveform(frame)

        # sherpa-onnx exposes is_speech_detected() as the rolling state.
        speaking_now = bool(self._vad.is_speech_detected())
        now = time.time()
        if speaking_now and not self._speaking:
            self._speaking = True
            self._speech_started_at = now
            events.append({"type": "speech-start", "at": now})
        elif not speaking_now and self._speaking:
            self._speaking = False
            duration_ms = int((now - self._speech_started_at) * 1000)
            events.append({"type": "speech-end", "at": now, "durationMs": duration_ms})

        return iter(events)

    def reset(self) -> None:
        try:
            self._vad.reset()
        except Exception:  # noqa: BLE001
            pass
        self._buf = np.zeros(0, dtype=np.float32)
        self._speaking = False
        self._speech_started_at = 0.0


def factory(settings) -> SileroVadEngine:
    return SileroVadEngine(settings)
