"""
Wire protocol for voice-core.

Frame contracts shared by the FastAPI server and the deck's TS clients
(`lib/voice/streaming-stt.ts`, `streaming-tts.ts`, plus future
`/wake/stream` and `/vad/stream` clients).

PCM convention everywhere is the same:
    Int16 little-endian, mono, 16 kHz unless explicitly negotiated.

JSON frames carry op/type plus minimal scalar fields. Keeping these typed in
one place stops the wire from drifting between server and clients.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Common constants
# ---------------------------------------------------------------------------

DEFAULT_PCM_SAMPLE_RATE = 16_000


# ---------------------------------------------------------------------------
# /stt/stream
# ---------------------------------------------------------------------------


class SttClientOp(BaseModel):
    op: Literal["flush", "final", "reset"]


class SttServerReady(BaseModel):
    type: Literal["ready"] = "ready"
    engine: str
    sampleRate: int = DEFAULT_PCM_SAMPLE_RATE


class SttServerPartial(BaseModel):
    type: Literal["partial"] = "partial"
    text: str


class SttServerFinal(BaseModel):
    type: Literal["final"] = "final"
    text: str


class SttServerError(BaseModel):
    type: Literal["error"] = "error"
    error: str


# ---------------------------------------------------------------------------
# Timing (opt-in via ?debug=timing on any streaming WS endpoint)
# ---------------------------------------------------------------------------


class TimingFrame(BaseModel):
    """Per-phase wall-clock measurement emitted by engines when timing is on.

    Phases use a dotted namespace so the lab UI can group them:
        stt.inference, stt.partial_emit, stt.final_emit
        vad.frame_inference, vad.speech_start, vad.speech_end
        tts.synth_per_phrase, tts.first_chunk_emit, tts.end_emit
    """

    type: Literal["timing"] = "timing"
    phase: str
    ms: float
    meta: dict[str, Any] | None = None


# ---------------------------------------------------------------------------
# /tts/stream
# ---------------------------------------------------------------------------


class TtsClientSpeak(BaseModel):
    op: Literal["speak"]
    text: str
    voice: str | None = None
    speed: float = 1.0
    utteranceId: str | None = None


class TtsClientClose(BaseModel):
    op: Literal["close"]


class TtsServerStart(BaseModel):
    type: Literal["start"] = "start"
    sampleRate: int
    utteranceId: str | None = None


class TtsServerEnd(BaseModel):
    type: Literal["end"] = "end"
    utteranceId: str | None = None


class TtsServerError(BaseModel):
    type: Literal["error"] = "error"
    error: str
    utteranceId: str | None = None


# ---------------------------------------------------------------------------
# /wake/stream
# ---------------------------------------------------------------------------


class WakeClientOp(BaseModel):
    op: Literal["reset", "set_threshold"] | None = None
    threshold: float | None = None


class WakeServerReady(BaseModel):
    type: Literal["ready"] = "ready"
    engine: str
    sampleRate: int = DEFAULT_PCM_SAMPLE_RATE
    keywords: list[str] = Field(default_factory=list)
    threshold: float = 0.5


class WakeServerHit(BaseModel):
    type: Literal["wake"] = "wake"
    keyword: str
    score: float
    at: float  # epoch seconds


class WakeServerScore(BaseModel):
    """Optional debug score frame; emitted only when `debug=1` on the URL."""

    type: Literal["score"] = "score"
    keyword: str
    score: float


class WakeServerError(BaseModel):
    type: Literal["error"] = "error"
    error: str


# ---------------------------------------------------------------------------
# /vad/stream
# ---------------------------------------------------------------------------


class VadClientOp(BaseModel):
    op: Literal["reset", "set_threshold"] | None = None
    threshold: float | None = None


class VadServerReady(BaseModel):
    type: Literal["ready"] = "ready"
    engine: str
    sampleRate: int = DEFAULT_PCM_SAMPLE_RATE
    threshold: float = 0.5
    minSpeechMs: int = 100
    minSilenceMs: int = 250


class VadServerSpeechStart(BaseModel):
    type: Literal["speech-start"] = "speech-start"
    at: float


class VadServerSpeechEnd(BaseModel):
    type: Literal["speech-end"] = "speech-end"
    at: float
    durationMs: int


class VadServerError(BaseModel):
    type: Literal["error"] = "error"
    error: str


# ---------------------------------------------------------------------------
# /speaker/*
# ---------------------------------------------------------------------------


class SpeakerEnrollResponse(BaseModel):
    speakerId: str
    embedding: list[float] | None = None
    durationMs: int
    engine: str


class SpeakerVerifyResponse(BaseModel):
    speakerId: str
    matched: bool
    score: float
    threshold: float
    engine: str


# ---------------------------------------------------------------------------
# /audio/diarize-file
# ---------------------------------------------------------------------------


class DiarizationSegment(BaseModel):
    speaker: str
    startMs: int
    endMs: int
    text: str | None = None


class DiarizationResponse(BaseModel):
    engine: str
    segments: list[DiarizationSegment]
    durationMs: int


# ---------------------------------------------------------------------------
# /models, /health, /diagnostics
# ---------------------------------------------------------------------------


class EngineStatus(BaseModel):
    id: str
    kind: Literal["stt", "tts", "vad", "wake", "speaker", "diarize", "enhance"]
    available: bool
    loaded: bool
    label: str
    sizeMb: int | None = None
    note: str | None = None


class HealthResponse(BaseModel):
    ok: bool = True
    tier: str | None = None
    version: str
    engines: dict[str, EngineStatus]


class DiagnosticsResponse(BaseModel):
    """Snapshot used by the deck's audio diagnostics drawer."""

    ok: bool = True
    tier: str | None
    version: str
    pid: int
    uptimeSeconds: float
    activeStreams: dict[str, int]
    lastErrors: list[dict[str, Any]] = Field(default_factory=list)
    devices: dict[str, Any] = Field(default_factory=dict)
