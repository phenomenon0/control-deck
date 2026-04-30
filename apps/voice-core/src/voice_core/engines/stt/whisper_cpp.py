"""
whisper.cpp via pywhispercpp.

Mac default — uses CoreML on Apple Silicon when ggml-*.bin sits next to a
matching mlmodelc bundle (requires a custom-built libwhisper with
WHISPER_COREML=1; the pip wheel is Metal-only). Loads any ggml-*.bin we find
under `<models_dir>/<model_dir_name>/`.

Quality knobs (env vars, applied at transcribe time):
  VOICE_CORE_WHISPER_PROMPT          Override the bias prompt sent as
                                     `initial_prompt`. Default: a punctuation/
                                     casing-steering one-liner.
  VOICE_CORE_WHISPER_VOCAB           Comma-separated vocabulary entries.
                                     APPENDED to the built-in default list
                                     (see `_DEFAULT_VOCAB` below).
  VOICE_CORE_WHISPER_VOCAB_REPLACE   When set to 1/true/yes, treat the env
                                     vocab as the *only* vocab — skip the
                                     defaults entirely.
  VOICE_CORE_WHISPER_PREPROCESS      0/false/no disables the noisereduce
                                     + peak-normalize pass on incoming audio.
"""

from __future__ import annotations

import logging
import os
import time
from collections.abc import Iterator
from typing import Any

import numpy as np

from voice_core import audio_utils
from voice_core.engines.base import (
    EngineMeta,
    StreamingStt,
    StreamingSttSession,
)

LOG = logging.getLogger("voice-core.stt.whisper-cpp")

SAMPLE_RATE = 16_000
PARTIAL_INTERVAL_S = 1.0
MAX_BUFFER_S = 30.0

# Bias prompt steers Whisper toward proper punctuation + casing + named-entity
# capitalization. Whisper's `initial_prompt` is technically a "previous context"
# slot, but in practice it acts as a style hint.
_DEFAULT_BIAS_PROMPT = (
    "Transcribe accurately with proper punctuation, casing, and capitalized "
    "proper nouns. Use full sentences."
)

# Preprocessing toggle: 1/true/yes (default true on Mac) enables noisereduce +
# peak normalization on the buffered audio before transcribe. Disable with
# VOICE_CORE_WHISPER_PREPROCESS=0 if you suspect the cleaner is hurting
# transcription on already-clean audio (rare; usually a clear win on mic input).
_PREPROCESS_ENABLED = os.environ.get(
    "VOICE_CORE_WHISPER_PREPROCESS", "1"
).strip().lower() in ("1", "true", "yes", "on")


# ---------------------------------------------------------------------------
# Default vocabulary bias list
#
# These are terms that Whisper commonly mishears, miscapitalises, or splits
# incorrectly without a hint.  Sources: OpenAI Cookbook "Whisper Prompting
# Guide", whisper.cpp issues #1979 / discussion #602, openai/whisper
# discussions #328 / #963, SuperWhisper trainer presets (react-typescript,
# data-science), developer voice-coding practitioner reports (willowvoice,
# dictationformac, zackproser).
#
# Rules for this list:
#   • Only include terms Whisper actually mangles — not generic dictionary words.
#   • Prefer short tokens; multi-word phrases cost 2+ tokens each.
#   • Hard limit: Whisper's initial_prompt window is 224 tokens total.
#     The preamble sentence + "Vocabulary: " header burn ~16 tokens, leaving
#     ~208 tokens for the comma-separated list.  Keep the joined string under
#     ~800 characters to stay safely within budget.
#
# Extend at runtime (additive) via:
#   VOICE_CORE_WHISPER_VOCAB="MyTerm, AnotherTerm"
# Replace entirely via:
#   VOICE_CORE_WHISPER_VOCAB_REPLACE=1 VOICE_CORE_WHISPER_VOCAB="..."
# ---------------------------------------------------------------------------
_DEFAULT_VOCAB: list[str] = [
    # --- Modern web / JS stack ---
    # Whisper splits camelCase names or lowercases brand names.
    # e.g. "TypeScript" → "type script", "shadcn" → "shadow CN", "tRPC" → "T R P C"
    "TypeScript", "JavaScript", "JSX", "TSX",
    "Next.js", "Vite", "Bun", "Node.js",
    "npm", "pnpm",
    "shadcn", "tRPC", "Zod", "Prisma", "Vercel",
    "useState", "useEffect",

    # --- Cloud + infra ---
    # Compound names split: "Kubernetes" → "Cuba net is", "PostgreSQL" → "Postgre SQL"
    "Kubernetes", "k8s", "Terraform",
    "PostgreSQL", "MongoDB", "Redis",
    "gRPC", "GraphQL", "WebSocket", "YAML",
    "Cloudflare", "nginx", "FastAPI",

    # --- Auth / security ---
    # OAuth → "O Auth"; JWT → spelled letter-by-letter; OIDC → "OI DC"; mTLS → "M T L S"
    "OAuth", "JWT", "OIDC", "mTLS",

    # --- AI / ML ---
    # Post-training-cutoff terms with near-zero Whisper training signal.
    # RAG → "rag", LoRA → "Lora" (name), QLoRA → "colorway", GGUF → "guff"
    "LLM", "RAG", "RLHF", "LoRA", "QLoRA",
    "embedding", "tokenizer",
    "GPT-4", "Claude", "Llama", "Mistral",
    "Anthropic", "OpenAI",
    "Ollama", "vLLM",
    "CUDA", "cuDNN", "MLX", "ggml", "GGUF",

    # --- Apple / macOS ---
    # CoreML → "core mail" / "core ML"; ANE → "any" / "Annie"; ggml on ANE is a key phrase
    "M1", "M2", "M3", "M4",
    "CoreML", "ANE", "Metal", "Xcode", "SwiftUI",
    "macOS", "iOS", "iPhone",

    # --- Voice / speech pipeline (Control Deck's own stack) ---
    # pywhispercpp → "pie whisper C P P"; sherpa-onnx → "sherpa onyx";
    # Kokoro → "Kakoro" / "co-coro"; WhisperX → "whisper ex"
    "pywhispercpp", "sherpa-onnx", "WhisperX",
    "Kokoro", "Silero", "OpenWakeWord",
    "VAD", "TTS", "STT", "ASR", "WER", "RTF", "ONNX",

    # --- Dev tools ---
    # GitHub → "git hub" (two words, lowercase); Neovim → "Neo vim"
    "GitHub", "Neovim", "Homebrew",

    # --- Browser / protocol acronyms ---
    # These are spoken aloud but Whisper treats them as spelled-out letters
    "DOM", "WebGL", "WebGPU", "WebRTC",
]


def _build_initial_prompt() -> str:
    base = os.environ.get("VOICE_CORE_WHISPER_PROMPT", _DEFAULT_BIAS_PROMPT).strip()

    vocab_raw = os.environ.get("VOICE_CORE_WHISPER_VOCAB", "").strip()
    extra = [t.strip() for t in vocab_raw.split(",") if t.strip()] if vocab_raw else []

    replace_mode = os.environ.get(
        "VOICE_CORE_WHISPER_VOCAB_REPLACE", ""
    ).strip().lower() in ("1", "true", "yes")

    if replace_mode:
        terms = extra if extra else _DEFAULT_VOCAB
    else:
        # Additive: built-in defaults first, then user-supplied extras.
        # Deduplicate while preserving order (built-ins win on collision).
        seen: set[str] = set()
        terms = []
        for t in _DEFAULT_VOCAB + extra:
            key = t.lower()
            if key not in seen:
                seen.add(key)
                terms.append(t)

    if not terms:
        return base
    return f"{base} Vocabulary: {', '.join(terms)}."


def _preprocess_for_whisper(audio: np.ndarray, sample_rate: int) -> np.ndarray:
    """Reduce stationary background noise + peak-normalize before transcribe.

    Costs ~30-80 ms on a 5 s clip; lifts WER on noisy mic audio noticeably and
    is essentially free on clean audio. Failures fall back to the input.
    """
    if not _PREPROCESS_ENABLED or audio.size == 0:
        return audio
    try:
        import noisereduce as nr  # type: ignore

        # Stationary mode is cheap and well-suited to room hum / fan noise.
        # prop_decrease=0.7 keeps speech transient texture, removes most floor.
        reduced = nr.reduce_noise(
            y=audio,
            sr=sample_rate,
            stationary=True,
            prop_decrease=0.7,
        )
        # Peak-normalize to -1 dBFS so quiet utterances reach Whisper at the
        # level it expects without clipping.
        peak = float(np.max(np.abs(reduced))) if reduced.size else 0.0
        if peak > 0:
            target = 10 ** (-1.0 / 20.0)  # -1 dBFS
            reduced = reduced * (target / peak)
        return reduced.astype(np.float32, copy=False)
    except Exception as exc:  # noqa: BLE001
        LOG.warning("whisper preprocess failed; using raw audio: %s", exc)
        return audio


def _load_model(models_dir, dir_name: str):
    from pywhispercpp.model import Model  # type: ignore

    target = models_dir / dir_name
    candidate = next(target.rglob("ggml-*.bin"), None) or next(target.rglob("*.bin"), None)
    if candidate is None:
        raise RuntimeError(f"whisper.cpp: no ggml-*.bin under {target}")
    return Model(str(candidate))


def _decode(model, audio: np.ndarray) -> str:
    if len(audio) == 0:
        return ""
    cleaned = _preprocess_for_whisper(audio, SAMPLE_RATE)
    segs = model.transcribe(cleaned, initial_prompt=_build_initial_prompt())
    return " ".join(s.text.strip() for s in segs).strip()


class WhisperCppEngine(StreamingStt):
    """Backs every whisper.cpp variant. The concrete model is selected by
    `model_dir_name` — the subdirectory under `models_dir/voice-engines/`
    containing the ggml-*.bin (and optional CoreML mlmodelc bundle)."""

    def __init__(self, settings, *, engine_id: str, label: str, size_mb: int, note: str, model_dir_name: str):
        self._settings = settings
        self._model = None
        self._loaded = False
        self._model_dir_name = model_dir_name
        self.meta = EngineMeta(
            id=engine_id,
            label=label,
            kind="stt",
            size_mb=size_mb,
            note=note,
        )

    def available(self) -> bool:
        try:
            import pywhispercpp  # noqa: F401
        except Exception:  # noqa: BLE001
            return False
        return True

    def load(self) -> None:
        if self._loaded:
            return
        self._model = _load_model(self._settings.models_dir, self._model_dir_name)
        self._loaded = True
        LOG.info("whisper.cpp loaded id=%s dir=%s", self.meta.id, self._model_dir_name)

    def transcribe(
        self, audio_pcm16: bytes, sample_rate: int, language: str | None = None
    ) -> dict[str, Any]:
        self.load()
        audio = audio_utils.pcm16_to_float32(audio_pcm16)
        audio = audio_utils.resample(audio, sample_rate, SAMPLE_RATE)
        text = _decode(self._model, audio)
        return {"text": text, "duration": len(audio) / SAMPLE_RATE}

    def open(self, language: str | None = None) -> StreamingSttSession:
        self.load()
        return _WhisperCppSession(self._model)


class _WhisperCppSession(StreamingSttSession):
    def __init__(self, model):
        self._model = model
        self._buf = bytearray()
        self._last_partial_at = 0.0
        self._last_text = ""

    def push(self, audio_pcm16: bytes) -> Iterator[dict[str, Any]]:
        self._buf.extend(audio_pcm16)
        max_bytes = int(MAX_BUFFER_S * SAMPLE_RATE * 2)
        if len(self._buf) > max_bytes:
            del self._buf[: len(self._buf) - max_bytes]

        now = time.monotonic()
        if now - self._last_partial_at < PARTIAL_INTERVAL_S:
            return iter(())
        self._last_partial_at = now
        text = _decode(self._model, audio_utils.pcm16_to_float32(self._buf))
        if text and text != self._last_text:
            self._last_text = text
            return iter([{"type": "partial", "text": text}])
        return iter(())

    def flush(self) -> Iterator[dict[str, Any]]:
        text = _decode(self._model, audio_utils.pcm16_to_float32(self._buf))
        if not text:
            return iter(())
        self._last_text = text
        return iter([{"type": "partial", "text": text}])

    def final(self) -> Iterator[dict[str, Any]]:
        text = _decode(self._model, audio_utils.pcm16_to_float32(self._buf))
        self.reset()
        return iter([{"type": "final", "text": text or ""}])

    def reset(self) -> None:
        self._buf = bytearray()
        self._last_partial_at = 0.0
        self._last_text = ""


def factory(settings) -> WhisperCppEngine:
    """Default whisper.cpp engine — large-v3-turbo. The big-and-accurate option."""
    return WhisperCppEngine(
        settings,
        engine_id="whisper-large-v3-turbo-cpp",
        label="Whisper large-v3-turbo (whisper.cpp / CoreML)",
        size_mb=1600,
        note="ANE-accelerated on Apple Silicon. Used as final-correction on T1.",
        model_dir_name="whisper-large-v3-turbo-cpp",
    )


def factory_base_en(settings) -> WhisperCppEngine:
    """Smaller, English-only base model — ~10x faster than large-turbo, trades
    a few WER points for sub-second correction even on long utterances. Best
    pick when sherpa partials are doing the heavy live-feel lifting."""
    return WhisperCppEngine(
        settings,
        engine_id="whisper-base-en-cpp",
        label="Whisper base.en (whisper.cpp)",
        size_mb=148,
        note="Small + English-only — fast correction pass behind sherpa partials.",
        model_dir_name="whisper-base-en-cpp",
    )
