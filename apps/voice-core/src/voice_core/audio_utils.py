"""
Audio buffer helpers shared across engines.

Wire convention: Int16 LE PCM @ 16 kHz mono. These helpers convert to/from the
internal Float32 view that ONNX models prefer. Resampling uses `scipy.signal`
when needed.
"""

from __future__ import annotations

import numpy as np
import scipy.signal as sps


PCM_DTYPE = np.int16
PCM_SCALE = 32_768.0


def pcm16_to_float32(buf: bytes | bytearray | memoryview) -> np.ndarray:
    """Decode Int16 LE bytes to a Float32 array in [-1, 1]."""
    raw = np.frombuffer(buf, dtype=PCM_DTYPE)
    return (raw.astype(np.float32) / PCM_SCALE).copy()


def float32_to_pcm16(samples: np.ndarray) -> bytes:
    """Encode Float32 [-1, 1] to Int16 LE bytes."""
    clipped = np.clip(samples, -1.0, 1.0)
    return (clipped * (PCM_SCALE - 1)).astype(PCM_DTYPE).tobytes()


def resample(samples: np.ndarray, src_rate: int, dst_rate: int) -> np.ndarray:
    if src_rate == dst_rate:
        return samples
    n = int(round(len(samples) * dst_rate / src_rate))
    if n <= 0:
        return np.zeros(0, dtype=samples.dtype)
    return sps.resample(samples, n).astype(samples.dtype, copy=False)


def chunked(samples: np.ndarray, chunk_size: int):
    """Yield non-overlapping chunks of `chunk_size` samples."""
    for i in range(0, len(samples), chunk_size):
        yield samples[i : i + chunk_size]
