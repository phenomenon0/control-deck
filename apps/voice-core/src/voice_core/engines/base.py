"""
Engine ABCs.

All engines implement one of:
    SttEngine      — batch transcription (returns text + word-level if available)
    StreamingStt   — streaming transcription (yields partial/final text frames)
    TtsEngine      — synthesise text → Int16 LE PCM (single utterance)
    StreamingTts   — phrase-by-phrase synth, yields chunks as soon as they're ready
    VadEngine      — frame-by-frame voice activity detection
    WakeEngine     — keyword detection (e.g. "Hey Deck")
    SpeakerEngine  — enroll + verify speaker embeddings
    DiarizeEngine  — file-level diarisation

Engines are loaded lazily — `available()` may return False if the optional
dependency isn't installed, in which case `/health` reports it cleanly without
the process crashing.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator, Iterator
from dataclasses import dataclass
from typing import Any

import numpy as np


@dataclass
class EngineMeta:
    id: str
    label: str
    kind: str
    size_mb: int | None = None
    note: str | None = None


class Engine(ABC):
    meta: EngineMeta

    @abstractmethod
    def available(self) -> bool:
        """Return True if the optional deps are importable on this machine."""

    def loaded(self) -> bool:
        """Return True after lazy weights are in memory."""
        return getattr(self, "_loaded", False)

    def load(self) -> None:
        """Idempotent. Subclasses set self._loaded = True when done."""
        self._loaded = True


# ---------------------------------------------------------------------------
# STT
# ---------------------------------------------------------------------------


class SttEngine(Engine):
    @abstractmethod
    def transcribe(
        self, audio_pcm16: bytes, sample_rate: int, language: str | None = None
    ) -> dict[str, Any]:
        """Returns {text, language?, duration?, words?}."""


class StreamingStt(Engine):
    @abstractmethod
    def open(self, language: str | None = None) -> "StreamingSttSession":
        """Allocate a per-connection decoding session."""


class StreamingSttSession(ABC):
    @abstractmethod
    def push(self, audio_pcm16: bytes) -> Iterator[dict[str, Any]]:
        """Feed audio; yield {type:'partial'|'final', text} frames as they form."""

    @abstractmethod
    def flush(self) -> Iterator[dict[str, Any]]:
        """Emit a partial covering everything seen so far."""

    @abstractmethod
    def final(self) -> Iterator[dict[str, Any]]:
        """End-of-utterance — yield one {type:'final', text} then reset."""

    @abstractmethod
    def reset(self) -> None:
        """Drop buffered state without emitting."""

    def close(self) -> None:
        """Release weights, files, etc."""


# ---------------------------------------------------------------------------
# TTS
# ---------------------------------------------------------------------------


class TtsEngine(Engine):
    sample_rate: int

    @abstractmethod
    def synthesise(
        self, text: str, voice: str | None = None, speed: float = 1.0
    ) -> bytes:
        """Return Int16 LE PCM at `self.sample_rate`."""


class StreamingTts(Engine):
    sample_rate: int

    @abstractmethod
    def stream(
        self, text: str, voice: str | None = None, speed: float = 1.0
    ) -> Iterator[bytes]:
        """
        Yield Int16 LE PCM chunks per phrase. Implementations should split the
        text into phrases and emit each chunk as soon as synth finishes — that
        way the client gets first-audio-out within the synth time of the
        shortest phrase.
        """


# ---------------------------------------------------------------------------
# VAD
# ---------------------------------------------------------------------------


class VadEngine(Engine):
    sample_rate: int = 16_000

    @abstractmethod
    def open(self, *, threshold: float = 0.5) -> "VadSession":
        ...


class VadSession(ABC):
    @abstractmethod
    def push(self, audio_pcm16: bytes) -> Iterator[dict[str, Any]]:
        """Yield {type:'speech-start'|'speech-end', at, durationMs?} frames."""

    @abstractmethod
    def reset(self) -> None: ...


# ---------------------------------------------------------------------------
# Wake
# ---------------------------------------------------------------------------


class WakeEngine(Engine):
    sample_rate: int = 16_000
    keywords: list[str]

    @abstractmethod
    def open(self, *, threshold: float = 0.5) -> "WakeSession":
        ...


class WakeSession(ABC):
    @abstractmethod
    def push(self, audio_pcm16: bytes) -> Iterator[dict[str, Any]]:
        """Yield {type:'wake', keyword, score, at} frames; optionally {type:'score'}."""

    @abstractmethod
    def reset(self) -> None: ...


# ---------------------------------------------------------------------------
# Speaker
# ---------------------------------------------------------------------------


class SpeakerEngine(Engine):
    @abstractmethod
    def embed(self, audio_pcm16: bytes, sample_rate: int) -> np.ndarray:
        """Return a 1-D float32 embedding."""

    def cosine(self, a: np.ndarray, b: np.ndarray) -> float:
        denom = float(np.linalg.norm(a) * np.linalg.norm(b)) + 1e-9
        return float(np.dot(a, b) / denom)


# ---------------------------------------------------------------------------
# Diarize
# ---------------------------------------------------------------------------


class DiarizeEngine(Engine):
    @abstractmethod
    def diarize_file(self, path: str) -> list[dict[str, Any]]:
        """Return list of {speaker, startMs, endMs, text?} segments."""
