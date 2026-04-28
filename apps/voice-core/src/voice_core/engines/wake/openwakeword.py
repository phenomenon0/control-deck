"""
openWakeWord — keyword spotting at the always-on tier.

Default keywords are the bundled "alexa", "hey jarvis", "hey mycroft". Override
via `VOICE_CORE_WAKE_KEYWORDS=keyword_a,keyword_b` or by dropping `.tflite` /
`.onnx` files into `<models_dir>/openwakeword/`.

Wire frames: client sends Int16 LE PCM @ 16 kHz mono. Server emits
`{type:"wake", keyword, score, at}` whenever the model crosses the threshold.
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
from voice_core.engines.base import EngineMeta, WakeEngine, WakeSession

LOG = logging.getLogger("voice-core.wake.openwakeword")

SAMPLE_RATE = 16_000
FRAME_SIZE = 1280  # openwakeword wants 80 ms windows (1280 samples @ 16 kHz)


def _model_dir(settings) -> Path:
    override = os.environ.get("VOICE_CORE_WAKE_DIR")
    if override:
        return Path(override).expanduser()
    return settings.models_dir / "openwakeword"


def _configured_keywords() -> list[str] | None:
    raw = os.environ.get("VOICE_CORE_WAKE_KEYWORDS")
    if not raw:
        return None
    return [k.strip() for k in raw.split(",") if k.strip()]


class OpenWakeWordEngine(WakeEngine):
    meta = EngineMeta(
        id="openwakeword",
        label="openWakeWord",
        kind="wake",
        size_mb=20,
        note="Apache-2.0. Detects bundled keywords + custom .tflite models.",
    )
    sample_rate = SAMPLE_RATE

    def __init__(self, settings):
        self._settings = settings
        self._loaded = False
        self.keywords: list[str] = []

    def available(self) -> bool:
        try:
            import openwakeword  # noqa: F401
        except Exception:  # noqa: BLE001
            return False
        return True

    def load(self) -> None:
        if self._loaded:
            return
        # We construct a fresh `Model` per session so callers can tweak the
        # threshold without bleeding state. Just verify the wheel here and
        # cache the configured kw list for /health.
        import openwakeword  # type: ignore

        kws = _configured_keywords()
        if kws is None:
            extra_dir = _model_dir(self._settings)
            extra: list[str] = []
            if extra_dir.exists():
                extra = [p.stem for p in extra_dir.glob("*.tflite")] + [
                    p.stem for p in extra_dir.glob("*.onnx")
                ]
            kws = extra or ["alexa", "hey_jarvis", "hey_mycroft"]
        self.keywords = kws
        self._loaded = True
        LOG.info("openWakeWord ready keywords=%s", self.keywords)

    def open(self, *, threshold: float = 0.5) -> WakeSession:
        self.load()
        from openwakeword.model import Model  # type: ignore

        kw_paths = []
        extra_dir = _model_dir(self._settings)
        if extra_dir.exists():
            kw_paths = [str(p) for p in extra_dir.glob("*.tflite")]
            kw_paths.extend(str(p) for p in extra_dir.glob("*.onnx"))

        if kw_paths:
            model = Model(wakeword_models=kw_paths, inference_framework="onnx")
        else:
            model = Model()  # bundled defaults

        return _OpenWakeWordSession(model, float(threshold))


class _OpenWakeWordSession(WakeSession):
    def __init__(self, model, threshold: float):
        self._model = model
        self._threshold = threshold
        self._buf = np.zeros(0, dtype=np.int16)
        self._cooldown_until: dict[str, float] = {}

    def push(self, audio_pcm16: bytes) -> Iterator[dict[str, Any]]:
        if not audio_pcm16:
            return iter(())
        new = np.frombuffer(audio_pcm16, dtype=np.int16)
        self._buf = np.concatenate([self._buf, new])
        events: list[dict[str, Any]] = []
        while len(self._buf) >= FRAME_SIZE:
            frame = self._buf[:FRAME_SIZE]
            self._buf = self._buf[FRAME_SIZE:]
            scores = self._model.predict(frame)
            now = time.time()
            for keyword, score in (scores or {}).items():
                # 800 ms cooldown so a single utterance doesn't fire twice.
                if now < self._cooldown_until.get(keyword, 0.0):
                    continue
                if score >= self._threshold:
                    self._cooldown_until[keyword] = now + 0.8
                    events.append(
                        {"type": "wake", "keyword": keyword, "score": float(score), "at": now}
                    )
        return iter(events)

    def reset(self) -> None:
        self._buf = np.zeros(0, dtype=np.int16)
        self._cooldown_until = {}
        try:
            self._model.reset()
        except Exception:  # noqa: BLE001
            pass


def factory(settings) -> OpenWakeWordEngine:
    return OpenWakeWordEngine(settings)
