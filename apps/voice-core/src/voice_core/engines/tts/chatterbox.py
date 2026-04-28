"""
Chatterbox — expressive TTS toggle.

Stub: declares itself unavailable until the wheel + weights are wired. The
endpoint surface is here so /health reports the engine consistently.
"""

from __future__ import annotations

from collections.abc import Iterator

import numpy as np

from voice_core.engines.base import EngineMeta, StreamingTts


class ChatterboxEngine(StreamingTts):
    meta = EngineMeta(
        id="chatterbox",
        label="Chatterbox (expressive TTS)",
        kind="tts",
        size_mb=2200,
        note="Expressive/cinematic voice — toggle for high-quality output.",
    )
    sample_rate = 24_000

    def __init__(self, settings):
        self._settings = settings
        self._loaded = False

    def available(self) -> bool:
        try:
            import chatterbox  # type: ignore # noqa: F401
        except Exception:  # noqa: BLE001
            return False
        return True

    def load(self) -> None:
        if self._loaded:
            return
        # Wheel presence is verified by available(); load on first synth.
        self._loaded = True

    def stream(
        self, text: str, voice: str | None = None, speed: float = 1.0
    ) -> Iterator[bytes]:
        if not self.available():
            return iter(())
        # Real synth path lands here once the wheel + weight loading is wired.
        # For now, emit a brief silent buffer so the protocol round-trip works
        # in dev when an operator toggles the engine without the model staged.
        silent = np.zeros(int(self.sample_rate * 0.2), dtype=np.int16)
        return iter([silent.tobytes()])


def factory(settings) -> ChatterboxEngine:
    return ChatterboxEngine(settings)
