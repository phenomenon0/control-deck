"""
pyannote.audio diarization.

Optional — gated on the heavy `pyannote.audio` + `torch` install. Used by
`/audio/diarize-file` for meeting-mode workflows.

Pipeline name comes from `VOICE_CORE_PYANNOTE_PIPELINE`
(default: `pyannote/speaker-diarization-3.1`). The HF token, if needed, is
read from `HUGGINGFACE_TOKEN` / `HF_TOKEN`.
"""

from __future__ import annotations

import logging
import os
from typing import Any

from voice_core.engines.base import DiarizeEngine, EngineMeta

LOG = logging.getLogger("voice-core.diarize.pyannote")


class PyannoteDiarizeEngine(DiarizeEngine):
    meta = EngineMeta(
        id="pyannote",
        label="pyannote.audio diarization",
        kind="diarize",
        size_mb=400,
        note="Optional meeting-mode diarisation. Requires HF auth for some pipelines.",
    )

    def __init__(self, settings):
        self._settings = settings
        self._pipeline = None
        self._loaded = False

    def available(self) -> bool:
        try:
            import pyannote.audio  # type: ignore # noqa: F401
        except Exception:  # noqa: BLE001
            return False
        return True

    def load(self) -> None:
        if self._loaded:
            return
        from pyannote.audio import Pipeline  # type: ignore

        name = os.environ.get(
            "VOICE_CORE_PYANNOTE_PIPELINE", "pyannote/speaker-diarization-3.1"
        )
        token = os.environ.get("HUGGINGFACE_TOKEN") or os.environ.get("HF_TOKEN")
        self._pipeline = Pipeline.from_pretrained(name, use_auth_token=token)
        self._loaded = True
        LOG.info("pyannote diarization pipeline loaded: %s", name)

    def diarize_file(self, path: str) -> list[dict[str, Any]]:
        self.load()
        diarization = self._pipeline(path)
        segments: list[dict[str, Any]] = []
        for turn, _, speaker in diarization.itertracks(yield_label=True):
            segments.append(
                {
                    "speaker": str(speaker),
                    "startMs": int(turn.start * 1000),
                    "endMs": int(turn.end * 1000),
                }
            )
        return segments


def factory(settings) -> PyannoteDiarizeEngine:
    return PyannoteDiarizeEngine(settings)
