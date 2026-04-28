"""
Tier resolution.

Three tiers — same semantics as `lib/inference/hardware-tiers.ts`:

    T1_MAC   Apple Silicon — whisper.cpp+CoreML default ASR, Kokoro TTS.
    T2_CUDA  NVIDIA — Parakeet/NeMo default ASR, Kokoro TTS, optional Orpheus.
    T3_CPU   No usable dGPU — Moonshine streaming ASR, Kokoro TTS.

Tier sets the `default_*` engine ids — concrete `engine=` query params override
on every request.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

TierId = Literal["T1_MAC", "T2_CUDA", "T3_CPU"]


@dataclass(frozen=True)
class TierDefaults:
    id: TierId
    label: str
    default_stt: str
    default_streaming_stt: str
    default_correction_stt: str | None
    default_tts: str
    default_expressive_tts: str | None
    default_vad: str
    default_wake: str
    default_speaker: str | None


_T1_MAC = TierDefaults(
    id="T1_MAC",
    label="Mac (Apple Silicon)",
    default_stt="whisper-large-v3-turbo-cpp",
    default_streaming_stt="sherpa-onnx-streaming",
    default_correction_stt="whisper-large-v3-turbo-cpp",
    default_tts="kokoro-82m",
    default_expressive_tts="chatterbox",
    default_vad="silero",
    default_wake="openwakeword",
    default_speaker="sherpa-onnx-speaker",
)

_T2_CUDA = TierDefaults(
    id="T2_CUDA",
    label="NVIDIA (CUDA)",
    default_stt="parakeet-tdt-0.6b-v2",
    default_streaming_stt="sherpa-onnx-streaming",
    default_correction_stt="faster-whisper",
    default_tts="kokoro-82m",
    default_expressive_tts="chatterbox",
    default_vad="silero",
    default_wake="openwakeword",
    default_speaker="sherpa-onnx-speaker",
)

_T3_CPU = TierDefaults(
    id="T3_CPU",
    label="CPU only",
    default_stt="moonshine-tiny",
    default_streaming_stt="sherpa-onnx-streaming",
    default_correction_stt=None,
    default_tts="kokoro-82m",
    default_expressive_tts=None,
    default_vad="silero",
    default_wake="openwakeword",
    default_speaker="sherpa-onnx-speaker",
)

_TIERS: dict[TierId, TierDefaults] = {
    "T1_MAC": _T1_MAC,
    "T2_CUDA": _T2_CUDA,
    "T3_CPU": _T3_CPU,
}


def resolve_tier(tier: str | None) -> TierDefaults:
    """Resolve a tier id to defaults; falls back to T3_CPU if unknown/None."""
    if not tier:
        return _T3_CPU
    return _TIERS.get(tier.upper(), _T3_CPU)  # type: ignore[arg-type]


def all_tiers() -> dict[str, TierDefaults]:
    return dict(_TIERS)
