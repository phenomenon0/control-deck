"""
Engine registry — maps id → factory, lazy-instantiates on first request.

The registry is the single place that knows which classes exist. Server code
asks for an engine by id and the registry constructs (or returns the cached
instance of) the right class.

Construction is wrapped in `try/except ImportError` so a missing optional dep
shows up as `available: false` in `/health` rather than killing the process.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from voice_core.engines.base import (
    DiarizeEngine,
    Engine,
    SpeakerEngine,
    SttEngine,
    StreamingStt,
    StreamingTts,
    TtsEngine,
    VadEngine,
    WakeEngine,
)

LOG = logging.getLogger("voice-core.registry")


# ---------------------------------------------------------------------------
# Factory registries
# ---------------------------------------------------------------------------


_STT: dict[str, Callable[[Any], SttEngine | StreamingStt]] = {}
_TTS: dict[str, Callable[[Any], TtsEngine | StreamingTts]] = {}
_VAD: dict[str, Callable[[Any], VadEngine]] = {}
_WAKE: dict[str, Callable[[Any], WakeEngine]] = {}
_SPEAKER: dict[str, Callable[[Any], SpeakerEngine]] = {}
_DIARIZE: dict[str, Callable[[Any], DiarizeEngine]] = {}


_INSTANCES: dict[str, Engine] = {}


def register_stt(engine_id: str, factory: Callable[[Any], SttEngine | StreamingStt]) -> None:
    _STT[engine_id] = factory


def register_tts(engine_id: str, factory: Callable[[Any], TtsEngine | StreamingTts]) -> None:
    _TTS[engine_id] = factory


def register_vad(engine_id: str, factory: Callable[[Any], VadEngine]) -> None:
    _VAD[engine_id] = factory


def register_wake(engine_id: str, factory: Callable[[Any], WakeEngine]) -> None:
    _WAKE[engine_id] = factory


def register_speaker(engine_id: str, factory: Callable[[Any], SpeakerEngine]) -> None:
    _SPEAKER[engine_id] = factory


def register_diarize(engine_id: str, factory: Callable[[Any], DiarizeEngine]) -> None:
    _DIARIZE[engine_id] = factory


# ---------------------------------------------------------------------------
# Lookup
# ---------------------------------------------------------------------------


def get(engine_id: str, settings: Any) -> Engine | None:
    """
    Resolve an engine by id, instantiating + caching if needed. Returns None
    when the id isn't registered or the optional deps are missing.
    """
    if engine_id in _INSTANCES:
        return _INSTANCES[engine_id]

    factory = _resolve_factory(engine_id)
    if factory is None:
        return None

    try:
        instance = factory(settings)
    except Exception:  # noqa: BLE001
        LOG.exception("voice-core registry: failed to instantiate %s", engine_id)
        return None

    if not instance.available():
        LOG.info("voice-core registry: %s reports available=False", engine_id)
        # Cache anyway so /health shows a stable shape.
        _INSTANCES[engine_id] = instance
        return instance

    _INSTANCES[engine_id] = instance
    return instance


def _resolve_factory(engine_id: str) -> Callable[[Any], Engine] | None:
    for table in (_STT, _TTS, _VAD, _WAKE, _SPEAKER, _DIARIZE):
        if engine_id in table:
            return table[engine_id]
    return None


def all_ids_by_kind() -> dict[str, list[str]]:
    return {
        "stt": list(_STT.keys()),
        "tts": list(_TTS.keys()),
        "vad": list(_VAD.keys()),
        "wake": list(_WAKE.keys()),
        "speaker": list(_SPEAKER.keys()),
        "diarize": list(_DIARIZE.keys()),
    }


def snapshot(settings: Any) -> dict[str, Engine]:
    """
    Instantiate (where possible) every registered engine and return a flat
    {id: Engine} dict for the /health and /models endpoints.
    """
    out: dict[str, Engine] = {}
    for table in (_STT, _TTS, _VAD, _WAKE, _SPEAKER, _DIARIZE):
        for engine_id in table:
            engine = get(engine_id, settings)
            if engine is not None:
                out[engine_id] = engine
    return out
