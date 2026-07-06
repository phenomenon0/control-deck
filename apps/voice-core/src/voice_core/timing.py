"""
Timing emitter shared by streaming engines.

Engines yield `{"type": "timing", "phase": ..., "ms": ...}` frames inline with
their normal frames. The server already serializes all yielded frames as JSON,
so no special routing is needed — timing rides the same WebSocket.

Emission is opt-in: the WS handler reads `?debug=timing` at accept time and
passes `enable_timing=True` into `engine.open(...)` (or per-call for TTS).

When timing is disabled the helpers no-op so production paths pay no overhead
beyond a single attribute read + bool check.
"""

from __future__ import annotations

import time
from contextlib import contextmanager
from typing import Any, Iterator


def make_emitter(enabled: bool):
    """Return a callable that records timing frames into a list.

    Usage:
        emit = make_emitter(enable_timing)
        # ... do work ...
        emit("stt.inference", elapsed_ms, meta={"engine": "sherpa"})
        for frame in emit.drain():
            yield frame
    """
    buf: list[dict[str, Any]] = []

    def emit(phase: str, ms: float, meta: dict[str, Any] | None = None) -> None:
        if not enabled:
            return
        frame: dict[str, Any] = {"type": "timing", "phase": phase, "ms": float(ms)}
        if meta:
            frame["meta"] = meta
        buf.append(frame)

    def drain() -> Iterator[dict[str, Any]]:
        while buf:
            yield buf.pop(0)

    emit.enabled = enabled  # type: ignore[attr-defined]
    emit.drain = drain  # type: ignore[attr-defined]
    return emit


@contextmanager
def measure(emit, phase: str, meta: dict[str, Any] | None = None):
    """Measure the body, then emit `phase` with elapsed ms when timing is on.

    The no-op fast path (`emit.enabled is False`) avoids perf_counter calls.
    """
    if not getattr(emit, "enabled", False):
        yield
        return
    t0 = time.perf_counter()
    try:
        yield
    finally:
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        emit(phase, elapsed_ms, meta)
