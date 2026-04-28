"""
Kokoro 82M (ONNX) — default low-latency TTS across every tier.

Splits the input text into phrases and emits one Int16 LE PCM chunk per
phrase. The deck's StreamingTtsClient queues each chunk into a single
AudioBuffer pipeline, so first-audio-out lands within the synth time of the
shortest phrase.

Weights ship as two release files: `kokoro-v1.0.onnx` + `voices-v1.0.bin`. We
auto-fetch them into `<models_dir>/kokoro-82m/` if they're missing.
"""

from __future__ import annotations

import logging
import re
import urllib.request
from collections.abc import Iterator
from pathlib import Path

import numpy as np

from voice_core.engines.base import EngineMeta, StreamingTts

LOG = logging.getLogger("voice-core.tts.kokoro")

_RELEASE_BASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
_RELEASE_FILES = ("kokoro-v1.0.onnx", "voices-v1.0.bin")

_PHRASE_SPLIT = re.compile(r"(?<=[.!?。])\s+|(?<=[,;:])\s+|\n{2,}")


def _ensure_release_files(target: Path) -> tuple[Path, Path]:
    target.mkdir(parents=True, exist_ok=True)
    paths = []
    for name in _RELEASE_FILES:
        dest = target / name
        if not dest.exists() or dest.stat().st_size == 0:
            url = f"{_RELEASE_BASE}/{name}"
            LOG.info("kokoro: fetching %s -> %s", url, dest)
            urllib.request.urlretrieve(url, dest)  # noqa: S310 (controlled URL)
        paths.append(dest)
    return paths[0], paths[1]


def _split_phrases(text: str) -> list[str]:
    parts = [p.strip() for p in _PHRASE_SPLIT.split(text or "") if p and p.strip()]
    return parts or ([text.strip()] if text and text.strip() else [])


class KokoroEngine(StreamingTts):
    meta = EngineMeta(
        id="kokoro-82m",
        label="Kokoro 82M (ONNX)",
        kind="tts",
        size_mb=330,
        note="Apache-2.0 — 50+ baked voices, ~150 ms first chunk on Apple Silicon.",
    )
    sample_rate = 24_000

    def __init__(self, settings):
        self._settings = settings
        self._model = None
        self._loaded = False
        self._default_voice = "af_sky"

    def available(self) -> bool:
        try:
            import kokoro_onnx  # noqa: F401
        except Exception:  # noqa: BLE001
            return False
        return True

    def load(self) -> None:
        if self._loaded:
            return
        import kokoro_onnx  # type: ignore

        target = self._settings.models_dir / "kokoro-82m"
        model_path, voices_path = _ensure_release_files(target)
        self._model = kokoro_onnx.Kokoro(str(model_path), str(voices_path))
        self._loaded = True
        LOG.info("kokoro-82m loaded from %s", target)

    def stream(
        self, text: str, voice: str | None = None, speed: float = 1.0
    ) -> Iterator[bytes]:
        self.load()
        chosen_voice = voice or self._default_voice
        for phrase in _split_phrases(text):
            audio, sr = self._model.create(phrase, voice=chosen_voice, speed=float(speed), lang="en-us")
            if sr != self.sample_rate:
                self.sample_rate = int(sr)
            arr = np.asarray(audio)
            if arr.dtype != np.int16:
                clipped = np.clip(arr.astype("float32"), -1.0, 1.0)
                pcm = (clipped * 32767.0).astype("int16")
            else:
                pcm = arr
            yield pcm.tobytes()


def factory(settings) -> KokoroEngine:
    return KokoroEngine(settings)
