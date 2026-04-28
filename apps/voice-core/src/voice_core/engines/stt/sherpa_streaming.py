"""
sherpa-onnx streaming ASR.

The streaming-friendly backbone: keeps a per-connection
`OnlineRecognizer` + `OnlineStream` and yields partials as soon as the
decoder produces them. Endpoint detection drives the `final` frame so the
deck doesn't need its own VAD-driven cut.

Default model: `sherpa-onnx-streaming-zipformer-en-2023-06-26`, expected
under `<models_dir>/sherpa-streaming/`.

Set `VOICE_CORE_SHERPA_STREAMING_DIR` to override the model dir.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import numpy as np

from voice_core import audio_utils
from voice_core.engines.base import (
    EngineMeta,
    StreamingStt,
    StreamingSttSession,
)

LOG = logging.getLogger("voice-core.stt.sherpa-streaming")

SAMPLE_RATE = 16_000


def _model_dir(settings) -> Path:
    override = os.environ.get("VOICE_CORE_SHERPA_STREAMING_DIR")
    if override:
        return Path(override).expanduser()
    return settings.models_dir / "sherpa-streaming"


def _load_recognizer(model_dir: Path):
    import sherpa_onnx  # type: ignore

    encoder = next(model_dir.glob("encoder-*.onnx"), None)
    decoder = next(model_dir.glob("decoder-*.onnx"), None)
    joiner = next(model_dir.glob("joiner-*.onnx"), None)
    tokens = next(model_dir.glob("tokens.txt"), None)
    if not (encoder and decoder and joiner and tokens):
        raise RuntimeError(
            f"sherpa-streaming: expected encoder/decoder/joiner/tokens under {model_dir}"
        )
    return sherpa_onnx.OnlineRecognizer.from_transducer(
        encoder=str(encoder),
        decoder=str(decoder),
        joiner=str(joiner),
        tokens=str(tokens),
        num_threads=2,
        sample_rate=SAMPLE_RATE,
        feature_dim=80,
        enable_endpoint_detection=True,
        rule1_min_trailing_silence=2.4,
        rule2_min_trailing_silence=1.2,
        rule3_min_utterance_length=20.0,
        decoding_method="greedy_search",
    )


class SherpaStreamingEngine(StreamingStt):
    meta = EngineMeta(
        id="sherpa-onnx-streaming",
        label="sherpa-onnx streaming ASR",
        kind="stt",
        size_mb=320,
        note="Backbone streaming ASR — endpoint-aware, runs on CPU. Pair with whisper-correction for high-quality finals.",
    )

    def __init__(self, settings):
        self._settings = settings
        self._recognizer = None
        self._loaded = False

    def available(self) -> bool:
        try:
            import sherpa_onnx  # noqa: F401
        except Exception:  # noqa: BLE001
            return False
        return _model_dir(self._settings).exists()

    def load(self) -> None:
        if self._loaded:
            return
        self._recognizer = _load_recognizer(_model_dir(self._settings))
        self._loaded = True
        LOG.info("sherpa-onnx streaming loaded")

    def transcribe(
        self, audio_pcm16: bytes, sample_rate: int, language: str | None = None
    ) -> dict[str, Any]:
        # Streaming-only model — wrap a one-shot through a temporary stream.
        self.load()
        session = self.open(language=language)
        try:
            list(session.push(audio_pcm16))
            text_frames = list(session.final())
            text = ""
            for frame in text_frames:
                if frame.get("type") == "final":
                    text = frame.get("text", "")
            return {"text": text, "duration": len(audio_pcm16) / 2 / sample_rate}
        finally:
            session.close()

    def open(self, language: str | None = None) -> StreamingSttSession:
        self.load()
        return _SherpaSession(self._recognizer)


class _SherpaSession(StreamingSttSession):
    def __init__(self, recognizer):
        self._recognizer = recognizer
        self._stream = recognizer.create_stream()
        self._last_partial = ""

    def _decode_loop(self) -> Iterator[dict[str, Any]]:
        while self._recognizer.is_ready(self._stream):
            self._recognizer.decode_streams([self._stream])
        text = (self._recognizer.get_result(self._stream) or "").strip()
        if text and text != self._last_partial:
            self._last_partial = text
            yield {"type": "partial", "text": text}
        if self._recognizer.is_endpoint(self._stream):
            final_text = (self._recognizer.get_result(self._stream) or "").strip()
            self._recognizer.reset(self._stream)
            self._last_partial = ""
            yield {"type": "final", "text": final_text}

    def push(self, audio_pcm16: bytes) -> Iterator[dict[str, Any]]:
        if not audio_pcm16:
            return iter(())
        audio = audio_utils.pcm16_to_float32(audio_pcm16)
        self._stream.accept_waveform(SAMPLE_RATE, audio)
        return iter(list(self._decode_loop()))

    def flush(self) -> Iterator[dict[str, Any]]:
        return iter(list(self._decode_loop()))

    def final(self) -> Iterator[dict[str, Any]]:
        # Signal end-of-stream and pump a final decode pass.
        self._stream.input_finished()
        events = list(self._decode_loop())
        # Make sure there's always one final frame.
        if not any(e.get("type") == "final" for e in events):
            text = (self._recognizer.get_result(self._stream) or "").strip()
            self._recognizer.reset(self._stream)
            self._last_partial = ""
            events.append({"type": "final", "text": text})
        return iter(events)

    def reset(self) -> None:
        self._recognizer.reset(self._stream)
        self._last_partial = ""

    def close(self) -> None:
        # sherpa_onnx streams clean up on GC; nothing to do.
        pass


def factory(settings) -> SherpaStreamingEngine:
    return SherpaStreamingEngine(settings)
