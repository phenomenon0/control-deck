"""
Engine package — importing this module registers every known engine with the
shared registry so the server's /health and /models endpoints report a stable
shape regardless of which optional deps are installed on the box.

Engines are gated at *load* time, not import time. A missing wheel makes
`available()` return False; the engine still appears in the registry.
"""

from __future__ import annotations

from voice_core import registry
from voice_core.engines.stt import moonshine, parakeet, sherpa_streaming, whisper_cpp, faster_whisper
from voice_core.engines.tts import chatterbox, kokoro, sherpa_tts
from voice_core.engines.vad import silero
from voice_core.engines.wake import openwakeword
from voice_core.engines.speaker import sherpa_speaker
from voice_core.engines.diarize import pyannote_diarize


def register_all() -> None:
    """Idempotent — call once at server startup before serving requests."""

    # STT
    registry.register_stt("moonshine-tiny", moonshine.factory)
    registry.register_stt("whisper-large-v3-turbo-cpp", whisper_cpp.factory)
    registry.register_stt("whisper-base-en-cpp", whisper_cpp.factory_base_en)
    registry.register_stt("parakeet-tdt-0.6b-v2", parakeet.factory)
    registry.register_stt("sherpa-onnx-streaming", sherpa_streaming.factory)
    registry.register_stt("faster-whisper", faster_whisper.factory)

    # TTS
    registry.register_tts("kokoro-82m", kokoro.factory)
    registry.register_tts("chatterbox", chatterbox.factory)
    registry.register_tts("sherpa-onnx-tts", sherpa_tts.factory)

    # VAD / Wake
    registry.register_vad("silero", silero.factory)
    registry.register_wake("openwakeword", openwakeword.factory)

    # Speaker / Diarize
    registry.register_speaker("sherpa-onnx-speaker", sherpa_speaker.factory)
    registry.register_diarize("pyannote", pyannote_diarize.factory)
