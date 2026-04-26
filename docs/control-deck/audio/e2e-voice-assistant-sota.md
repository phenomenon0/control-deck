# End-to-End Voice Assistant Model Pick

Date: 2026-04-26

## Decision

Use `Qwen/Qwen2.5-Omni-7B-AWQ` as the Deck's first local end-to-end voice-assistant candidate.

It is the best fit for this Deck because it is a downloadable Apache-2.0 model that can read audio and generate both text and natural speech from one model family. The AWQ checkpoint keeps the same end-to-end architecture while reducing short-input VRAM requirements from the full BF16 model's roughly 31 GB to about 11.8 GB.

## Why This One

Qwen2.5-Omni is explicitly designed as an end-to-end multimodal assistant: text, image, audio, and video input, with streaming text plus speech output. Its Thinker-Talker architecture keeps reasoning and speech generation coupled rather than stitching Whisper plus a text LLM plus TTS as three separate systems.

For a fully fledged voice assistant, that matters. The Deck can still keep the existing STT -> LLM -> TTS route for reliability, but Qwen2.5-Omni is the right research path for a native audio-in/audio-out assistant loop.

## Alternatives Considered

`MiniCPM-o 2.6` is very practical and phone-oriented. It supports bilingual real-time speech conversation, voice control features, and an int4 option around 7 GB. It is a strong fallback if the Deck prioritizes small-device operation over top open benchmark strength.

`Moshi` is the best architecture reference for true full-duplex voice UX. It models user and assistant audio streams directly and targets very low latency. It is less attractive as this Deck's first "brain" because the Qwen model is stronger as a general multimodal assistant, but Moshi is the right design reference for barge-in and live interrupt handling.

The current Deck route remains valuable: fast local STT plus a text model plus local/cloud TTS is easier to run on this machine today. The end-to-end model should initially be a separate sidecar lane, not a replacement for the existing voice path.

## Local Install

The selected snapshot is downloaded to:

```text
models/qwen2.5-omni-7b-awq
```

The model weights are intentionally ignored by git.

## Hardware Reality

This workstation currently does not expose a working NVIDIA driver through `nvidia-smi`. The AWQ model can be downloaded and validated locally, but full speech generation is expected to need a working CUDA device or a dedicated sidecar host with at least about 12 GB available VRAM for short audio/text turns.

## Deck Integration Plan

Implemented wiring:

1. The model is registered as `qwen-omni-local` in the unified inference registry.
2. It appears under the Deck modalities it honestly supports: Text, Vision, STT, and TTS.
3. `/api/voice/omni` checks the local snapshot and activates those modality bindings.
4. Opening `/deck/audio` auto-activates the bindings when the snapshot is ready.
5. `/deck/audio?tab=health` shows the Omni snapshot, CUDA/runtime state, smoke commands, supported modalities, and now the Omni sidecar URL plus its `/health` reachability.
6. `OMNI_SIDECAR_URL` env var threads through to the STT and TTS dispatchers: when set, `qwen-omni-local` STT calls `${OMNI_SIDECAR_URL}/stt` and TTS calls `${OMNI_SIDECAR_URL}/tts`. When unset, we fall back to the existing `voice-api` sidecar so behaviour stays safe in production.
7. `/api/voice/omni/respond` fronts the sidecar's `/e2e/respond` endpoint with the same auth gate as the rest of the deck APIs and returns 503 when no sidecar is configured.

Sidecar contract expected at `OMNI_SIDECAR_URL`:

- `GET /health` → `{ model: string, ... }` JSON, used for the Health-pane reachability pill.
- `POST /stt` → multipart `{audio, language?, timestamps?}` in, JSON out (`text`, `language`, `duration`, `words`).
- `POST /tts` → JSON `{text, voice, format, speed}` in, raw audio bytes out (`Content-Type` carried back).
- `POST /e2e/respond` → JSON or multipart in, `{text, audio}` JSON out — invoked through `/api/voice/omni/respond`.

Remaining work:

1. Keep the existing `voice-api` route as the safe production fallback until a CUDA sidecar is up.
2. Build the actual sidecar host once CUDA hardware is available; `scripts/qwen-omni-smoke.py --full` is the acceptance test.
3. Preserve barge-in, fillers, and WebSocket playback in the current client; only swap the backend that produces the assistant turn.
4. Optional: add a streaming variant of `/e2e/respond` once the sidecar supports incremental audio frames.

## Sources

- Qwen official release post: https://qwenlm.github.io/blog/qwen2.5-omni/
- Qwen2.5-Omni-7B model card: https://huggingface.co/Qwen/Qwen2.5-Omni-7B
- Qwen2.5-Omni-7B-AWQ model card: https://huggingface.co/Qwen/Qwen2.5-Omni-7B-AWQ
- MiniCPM-o 2.6 model card: https://huggingface.co/openbmb/MiniCPM-o-2_6
- Moshi repository: https://github.com/kyutai-labs/moshi
