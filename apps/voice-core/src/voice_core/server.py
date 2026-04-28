"""
voice-core FastAPI server.

Endpoints:

    GET  /health
    GET  /models
    GET  /diagnostics

    POST /stt   (multipart, batch one-shot)
    POST /tts   (JSON body, batch one-shot)

    WS   /stt/stream?engine=<id>&language=<>
    WS   /tts/stream?engine=<id>
    WS   /vad/stream?engine=<id>&threshold=<>
    WS   /wake/stream?engine=<id>&threshold=<>

    POST /speaker/enroll   (multipart audio + speakerId)
    POST /speaker/verify   (multipart audio + speakerId)

    POST /audio/diarize-file  (multipart audio file)

Wire convention everywhere:
    - PCM is Int16 LE @ 16 kHz mono.
    - JSON frames carry typed shapes from `voice_core.protocol`.

The server holds an in-memory speaker store (id → embedding) — verify is
strictly local. Persisted enrolment is a deck-side concern.
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
import os
import tempfile
import time
from collections.abc import Iterable
from typing import Any

import numpy as np
from fastapi import (
    FastAPI,
    File,
    Form,
    HTTPException,
    Request,
    Response,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.responses import JSONResponse, StreamingResponse

from voice_core import __version__, audio_utils, registry
from voice_core.config import Settings
from voice_core.engines import register_all
from voice_core.engines.base import (
    SpeakerEngine,
    SttEngine,
    StreamingStt,
    StreamingTts,
    TtsEngine,
    VadEngine,
    WakeEngine,
    DiarizeEngine,
)
from voice_core.protocol import (
    DEFAULT_PCM_SAMPLE_RATE,
    DiagnosticsResponse,
    DiarizationResponse,
    DiarizationSegment,
    EngineStatus,
    HealthResponse,
    SpeakerEnrollResponse,
    SpeakerVerifyResponse,
)

LOG = logging.getLogger("voice-core.server")

# In-memory speaker DB. Keyed by speakerId; value is a unit-norm embedding.
_SPEAKER_DB: dict[str, np.ndarray] = {}
_DEFAULT_VERIFY_THRESHOLD = 0.45

# Diagnostic counters.
_ACTIVE_STREAMS: dict[str, int] = {"stt": 0, "tts": 0, "vad": 0, "wake": 0}
_RECENT_ERRORS: list[dict[str, Any]] = []
_STARTED_AT = time.time()


def _record_error(scope: str, error: str) -> None:
    _RECENT_ERRORS.append({"scope": scope, "error": error, "at": time.time()})
    del _RECENT_ERRORS[:-32]


def build_app(settings: Settings) -> FastAPI:
    register_all()
    app = FastAPI(title="voice-core", version=__version__)

    # ------------------------------------------------------------------
    # /health, /models, /diagnostics
    # ------------------------------------------------------------------

    def _engine_statuses() -> dict[str, EngineStatus]:
        out: dict[str, EngineStatus] = {}
        for engine_id, engine in registry.snapshot(settings).items():
            meta = engine.meta
            out[engine_id] = EngineStatus(
                id=engine_id,
                kind=meta.kind,  # type: ignore[arg-type]
                available=engine.available(),
                loaded=engine.loaded(),
                label=meta.label,
                sizeMb=meta.size_mb,
                note=meta.note,
            )
        return out

    @app.get("/health")
    def health() -> JSONResponse:
        body = HealthResponse(
            ok=True,
            tier=settings.tier_id,
            version=__version__,
            engines=_engine_statuses(),
        )
        return JSONResponse(body.model_dump())

    @app.get("/models")
    def models() -> JSONResponse:
        return JSONResponse(
            {
                "tier": settings.tier_id,
                "defaults": {
                    "stt": settings.tier.default_stt,
                    "streaming_stt": settings.tier.default_streaming_stt,
                    "correction_stt": settings.tier.default_correction_stt,
                    "tts": settings.tier.default_tts,
                    "expressive_tts": settings.tier.default_expressive_tts,
                    "vad": settings.tier.default_vad,
                    "wake": settings.tier.default_wake,
                    "speaker": settings.tier.default_speaker,
                },
                "registered": registry.all_ids_by_kind(),
                "engines": {k: v.model_dump() for k, v in _engine_statuses().items()},
                "models_dir": str(settings.models_dir),
            }
        )

    @app.get("/diagnostics")
    def diagnostics() -> JSONResponse:
        body = DiagnosticsResponse(
            tier=settings.tier_id,
            version=__version__,
            pid=os.getpid(),
            uptimeSeconds=time.time() - _STARTED_AT,
            activeStreams=dict(_ACTIVE_STREAMS),
            lastErrors=list(_RECENT_ERRORS[-16:]),
            devices={
                "models_dir": str(settings.models_dir),
                "models_dir_exists": settings.models_dir.exists(),
                "speakers_enrolled": len(_SPEAKER_DB),
            },
        )
        return JSONResponse(body.model_dump())

    # ------------------------------------------------------------------
    # Batch /stt and /tts (one-shot endpoints, kept for non-streaming clients)
    # ------------------------------------------------------------------

    @app.post("/stt")
    async def stt_post(
        audio: UploadFile = File(...),
        engine: str | None = Form(default=None),
        language: str | None = Form(default=None),
    ) -> JSONResponse:
        engine_id = engine or settings.tier.default_stt
        instance = registry.get(engine_id, settings)
        if instance is None or not isinstance(instance, (SttEngine, StreamingStt)):
            raise HTTPException(404, f"unknown stt engine: {engine_id}")
        if not instance.available():
            raise HTTPException(503, f"stt engine {engine_id} unavailable on this host")

        raw = await audio.read()
        # Decode whatever the client sent into Int16 LE PCM @ 16 kHz mono.
        pcm = _decode_to_pcm16(raw, target_rate=DEFAULT_PCM_SAMPLE_RATE)
        if isinstance(instance, StreamingStt) and not isinstance(instance, SttEngine):
            session = instance.open(language=language)
            try:
                # Drive the streaming engine in one shot.
                list(session.push(pcm))
                final_text = ""
                for frame in session.final():
                    if frame.get("type") == "final":
                        final_text = frame.get("text", "")
                return JSONResponse({"text": final_text, "engine": engine_id})
            finally:
                session.close()
        result = instance.transcribe(pcm, DEFAULT_PCM_SAMPLE_RATE, language=language)
        result["engine"] = engine_id
        return JSONResponse(result)

    @app.post("/tts")
    async def tts_post(request: Request) -> Response:
        body = await request.json()
        text = (body.get("text") or "").strip()
        if not text:
            raise HTTPException(400, "text is required")
        engine_id = body.get("engine") or settings.tier.default_tts
        voice = body.get("voice")
        speed = float(body.get("speed", 1.0))

        instance = registry.get(engine_id, settings)
        if instance is None or not isinstance(instance, (TtsEngine, StreamingTts)):
            raise HTTPException(404, f"unknown tts engine: {engine_id}")
        if not instance.available():
            raise HTTPException(503, f"tts engine {engine_id} unavailable on this host")

        if isinstance(instance, StreamingTts):
            chunks = b"".join(instance.stream(text, voice=voice, speed=speed))
            sample_rate = instance.sample_rate
        else:
            chunks = instance.synthesise(text, voice=voice, speed=speed)
            sample_rate = instance.sample_rate

        wav = _wrap_pcm_as_wav(chunks, sample_rate=sample_rate)
        return Response(content=wav, media_type="audio/wav")

    # ------------------------------------------------------------------
    # WS /stt/stream
    # ------------------------------------------------------------------

    @app.websocket("/stt/stream")
    async def stt_stream(ws: WebSocket) -> None:
        await ws.accept()
        engine_id = ws.query_params.get("engine") or settings.tier.default_streaming_stt
        language = ws.query_params.get("language")
        instance = registry.get(engine_id, settings)
        if instance is None or not isinstance(instance, (StreamingStt, SttEngine)):
            await _ws_error(ws, f"unknown stt engine: {engine_id}")
            return
        if not instance.available():
            await _ws_error(ws, f"stt engine {engine_id} unavailable")
            return

        # Wrap a non-streaming SttEngine in a one-shot session shim so the WS
        # contract stays uniform.
        if not isinstance(instance, StreamingStt):
            await _ws_error(ws, f"stt engine {engine_id} does not support streaming")
            return

        session = instance.open(language=language)
        await ws.send_text(
            json.dumps({"type": "ready", "engine": engine_id, "sampleRate": DEFAULT_PCM_SAMPLE_RATE})
        )
        _ACTIVE_STREAMS["stt"] += 1
        try:
            while True:
                msg = await ws.receive()
                kind = msg.get("type")
                if kind == "websocket.disconnect":
                    return
                if "bytes" in msg and msg["bytes"]:
                    for frame in session.push(msg["bytes"]):
                        await ws.send_text(json.dumps(frame))
                elif "text" in msg and msg["text"]:
                    op = json.loads(msg["text"]).get("op")
                    if op == "flush":
                        for frame in session.flush():
                            await ws.send_text(json.dumps(frame))
                    elif op == "final":
                        for frame in session.final():
                            await ws.send_text(json.dumps(frame))
                    elif op == "reset":
                        session.reset()
        except WebSocketDisconnect:
            return
        except Exception as exc:  # noqa: BLE001
            LOG.exception("stt stream failure")
            _record_error("stt-stream", str(exc))
            await _ws_error(ws, str(exc))
        finally:
            _ACTIVE_STREAMS["stt"] = max(0, _ACTIVE_STREAMS["stt"] - 1)
            try:
                session.close()
            except Exception:  # noqa: BLE001
                pass

    # ------------------------------------------------------------------
    # WS /tts/stream
    # ------------------------------------------------------------------

    @app.websocket("/tts/stream")
    async def tts_stream(ws: WebSocket) -> None:
        await ws.accept()
        engine_id = ws.query_params.get("engine") or settings.tier.default_tts
        instance = registry.get(engine_id, settings)
        if instance is None or not isinstance(instance, (StreamingTts, TtsEngine)):
            await _ws_error(ws, f"unknown tts engine: {engine_id}")
            return
        if not instance.available():
            await _ws_error(ws, f"tts engine {engine_id} unavailable")
            return

        _ACTIVE_STREAMS["tts"] += 1
        try:
            while True:
                msg = await ws.receive()
                if msg.get("type") == "websocket.disconnect":
                    return
                if "text" not in msg or not msg["text"]:
                    continue
                payload = json.loads(msg["text"])
                op = payload.get("op")
                if op == "close":
                    await ws.close()
                    return
                if op != "speak":
                    continue
                text = payload.get("text") or ""
                voice = payload.get("voice")
                speed = float(payload.get("speed", 1.0))
                utterance_id = payload.get("utteranceId")
                sample_rate = (
                    instance.sample_rate
                    if isinstance(instance, (StreamingTts, TtsEngine))
                    else DEFAULT_PCM_SAMPLE_RATE
                )
                await ws.send_text(
                    json.dumps(
                        {
                            "type": "start",
                            "sampleRate": sample_rate,
                            "utteranceId": utterance_id,
                        }
                    )
                )
                try:
                    if isinstance(instance, StreamingTts):
                        for chunk in instance.stream(text, voice=voice, speed=speed):
                            await ws.send_bytes(chunk)
                    else:
                        await ws.send_bytes(
                            instance.synthesise(text, voice=voice, speed=speed)
                        )
                    await ws.send_text(
                        json.dumps({"type": "end", "utteranceId": utterance_id})
                    )
                except Exception as exc:  # noqa: BLE001
                    LOG.exception("tts synth failure")
                    _record_error("tts-stream", str(exc))
                    await ws.send_text(
                        json.dumps(
                            {"type": "error", "error": str(exc), "utteranceId": utterance_id}
                        )
                    )
        except WebSocketDisconnect:
            return
        except Exception as exc:  # noqa: BLE001
            LOG.exception("tts stream failure")
            _record_error("tts-stream", str(exc))
            await _ws_error(ws, str(exc))
        finally:
            _ACTIVE_STREAMS["tts"] = max(0, _ACTIVE_STREAMS["tts"] - 1)

    # ------------------------------------------------------------------
    # WS /vad/stream
    # ------------------------------------------------------------------

    @app.websocket("/vad/stream")
    async def vad_stream(ws: WebSocket) -> None:
        await ws.accept()
        engine_id = ws.query_params.get("engine") or settings.tier.default_vad
        threshold = float(ws.query_params.get("threshold") or 0.5)
        instance = registry.get(engine_id, settings)
        if instance is None or not isinstance(instance, VadEngine):
            await _ws_error(ws, f"unknown vad engine: {engine_id}")
            return
        if not instance.available():
            await _ws_error(ws, f"vad engine {engine_id} unavailable")
            return

        session = instance.open(threshold=threshold)
        await ws.send_text(
            json.dumps(
                {
                    "type": "ready",
                    "engine": engine_id,
                    "sampleRate": instance.sample_rate,
                    "threshold": threshold,
                }
            )
        )
        _ACTIVE_STREAMS["vad"] += 1
        try:
            while True:
                msg = await ws.receive()
                if msg.get("type") == "websocket.disconnect":
                    return
                if "bytes" in msg and msg["bytes"]:
                    for frame in session.push(msg["bytes"]):
                        await ws.send_text(json.dumps(frame))
                elif "text" in msg and msg["text"]:
                    op = json.loads(msg["text"]).get("op")
                    if op == "reset":
                        session.reset()
        except WebSocketDisconnect:
            return
        except Exception as exc:  # noqa: BLE001
            LOG.exception("vad stream failure")
            _record_error("vad-stream", str(exc))
            await _ws_error(ws, str(exc))
        finally:
            _ACTIVE_STREAMS["vad"] = max(0, _ACTIVE_STREAMS["vad"] - 1)

    # ------------------------------------------------------------------
    # WS /wake/stream
    # ------------------------------------------------------------------

    @app.websocket("/wake/stream")
    async def wake_stream(ws: WebSocket) -> None:
        await ws.accept()
        engine_id = ws.query_params.get("engine") or settings.tier.default_wake
        threshold = float(ws.query_params.get("threshold") or 0.5)
        instance = registry.get(engine_id, settings)
        if instance is None or not isinstance(instance, WakeEngine):
            await _ws_error(ws, f"unknown wake engine: {engine_id}")
            return
        if not instance.available():
            await _ws_error(ws, f"wake engine {engine_id} unavailable")
            return

        session = instance.open(threshold=threshold)
        await ws.send_text(
            json.dumps(
                {
                    "type": "ready",
                    "engine": engine_id,
                    "sampleRate": instance.sample_rate,
                    "threshold": threshold,
                    "keywords": getattr(instance, "keywords", []),
                }
            )
        )
        _ACTIVE_STREAMS["wake"] += 1
        try:
            while True:
                msg = await ws.receive()
                if msg.get("type") == "websocket.disconnect":
                    return
                if "bytes" in msg and msg["bytes"]:
                    for frame in session.push(msg["bytes"]):
                        await ws.send_text(json.dumps(frame))
                elif "text" in msg and msg["text"]:
                    op = json.loads(msg["text"]).get("op")
                    if op == "reset":
                        session.reset()
        except WebSocketDisconnect:
            return
        except Exception as exc:  # noqa: BLE001
            LOG.exception("wake stream failure")
            _record_error("wake-stream", str(exc))
            await _ws_error(ws, str(exc))
        finally:
            _ACTIVE_STREAMS["wake"] = max(0, _ACTIVE_STREAMS["wake"] - 1)

    # ------------------------------------------------------------------
    # /speaker/enroll, /speaker/verify
    # ------------------------------------------------------------------

    @app.post("/speaker/enroll")
    async def speaker_enroll(
        speakerId: str = Form(...),
        audio: UploadFile = File(...),
        engine: str | None = Form(default=None),
    ) -> JSONResponse:
        engine_id = engine or settings.tier.default_speaker or "sherpa-onnx-speaker"
        instance = registry.get(engine_id, settings)
        if instance is None or not isinstance(instance, SpeakerEngine):
            raise HTTPException(404, f"unknown speaker engine: {engine_id}")
        if not instance.available():
            raise HTTPException(503, f"speaker engine {engine_id} unavailable")

        raw = await audio.read()
        pcm = _decode_to_pcm16(raw, target_rate=DEFAULT_PCM_SAMPLE_RATE)
        embedding = instance.embed(pcm, DEFAULT_PCM_SAMPLE_RATE)
        normalised = embedding / (np.linalg.norm(embedding) + 1e-9)
        _SPEAKER_DB[speakerId] = normalised
        body = SpeakerEnrollResponse(
            speakerId=speakerId,
            embedding=normalised.astype(float).tolist(),
            durationMs=int(len(pcm) / 2 / DEFAULT_PCM_SAMPLE_RATE * 1000),
            engine=engine_id,
        )
        return JSONResponse(body.model_dump())

    @app.post("/speaker/verify")
    async def speaker_verify(
        speakerId: str = Form(...),
        audio: UploadFile = File(...),
        engine: str | None = Form(default=None),
        threshold: float = Form(default=_DEFAULT_VERIFY_THRESHOLD),
    ) -> JSONResponse:
        engine_id = engine or settings.tier.default_speaker or "sherpa-onnx-speaker"
        instance = registry.get(engine_id, settings)
        if instance is None or not isinstance(instance, SpeakerEngine):
            raise HTTPException(404, f"unknown speaker engine: {engine_id}")
        if not instance.available():
            raise HTTPException(503, f"speaker engine {engine_id} unavailable")

        enrolled = _SPEAKER_DB.get(speakerId)
        if enrolled is None:
            raise HTTPException(404, f"speaker {speakerId} not enrolled")

        raw = await audio.read()
        pcm = _decode_to_pcm16(raw, target_rate=DEFAULT_PCM_SAMPLE_RATE)
        embedding = instance.embed(pcm, DEFAULT_PCM_SAMPLE_RATE)
        normalised = embedding / (np.linalg.norm(embedding) + 1e-9)
        score = float(np.dot(normalised, enrolled))
        body = SpeakerVerifyResponse(
            speakerId=speakerId,
            matched=score >= threshold,
            score=score,
            threshold=threshold,
            engine=engine_id,
        )
        return JSONResponse(body.model_dump())

    # ------------------------------------------------------------------
    # /audio/diarize-file
    # ------------------------------------------------------------------

    @app.post("/audio/diarize-file")
    async def audio_diarize(
        audio: UploadFile = File(...),
        engine: str | None = Form(default="pyannote"),
    ) -> JSONResponse:
        engine_id = engine or "pyannote"
        instance = registry.get(engine_id, settings)
        if instance is None or not isinstance(instance, DiarizeEngine):
            raise HTTPException(404, f"unknown diarize engine: {engine_id}")
        if not instance.available():
            raise HTTPException(
                503,
                f"diarize engine {engine_id} unavailable — install pyannote.audio + torch",
            )

        raw = await audio.read()
        with tempfile.NamedTemporaryFile(suffix=os.path.splitext(audio.filename or ".wav")[1] or ".wav", delete=False) as tf:
            tf.write(raw)
            path = tf.name
        try:
            t0 = time.time()
            segments = instance.diarize_file(path)
            duration_ms = int((time.time() - t0) * 1000)
            body = DiarizationResponse(
                engine=engine_id,
                durationMs=duration_ms,
                segments=[DiarizationSegment(**s) for s in segments],
            )
            return JSONResponse(body.model_dump())
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass

    return app


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _ws_error(ws: WebSocket, message: str) -> None:
    try:
        await ws.send_text(json.dumps({"type": "error", "error": message}))
        await ws.close()
    except Exception:  # noqa: BLE001
        pass


def _decode_to_pcm16(raw: bytes, target_rate: int) -> bytes:
    """
    Decode an arbitrary upload (wav/flac/ogg/mp3 if soundfile supports it,
    otherwise treat as raw PCM @ target_rate) into Int16 LE PCM @ target_rate.
    """
    import soundfile as sf  # type: ignore

    try:
        data, sr = sf.read(io.BytesIO(raw), dtype="float32", always_2d=False)
    except Exception:  # noqa: BLE001
        # Already raw PCM — assume it matches target_rate.
        return raw
    if data.ndim == 2:
        data = data.mean(axis=1)
    if sr != target_rate:
        data = audio_utils.resample(data, sr, target_rate)
    return audio_utils.float32_to_pcm16(data)


def _wrap_pcm_as_wav(pcm: bytes, sample_rate: int) -> bytes:
    import soundfile as sf  # type: ignore

    arr = np.frombuffer(pcm, dtype=np.int16)
    buf = io.BytesIO()
    sf.write(buf, arr, sample_rate, format="WAV", subtype="PCM_16")
    return buf.getvalue()
