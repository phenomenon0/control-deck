/**
 * voice-core sidecar URL resolution.
 *
 * The local Python sidecar at `apps/voice-core/` (port 4245) hosts every
 * audio inference engine the deck uses today: STT (Moonshine, whisper.cpp,
 * Parakeet, sherpa-onnx streaming, faster-whisper), TTS (Kokoro, Chatterbox,
 * sherpa-tts), VAD (Silero), wake (openWakeWord), speaker (sherpa-onnx),
 * diarisation (pyannote, optional).
 *
 * The legacy port-8000 `voice-api` sidecar has been retired — there is
 * exactly one local audio inference backend now.
 *
 * Routing rule: if the slot-bound model id is in `VOICE_ENGINES_SIDECAR_IDS`
 * (declared in `lib/inference/hardware-tiers.ts`) we hit voice-core. The set
 * doubles as a feature flag — unknown ids yield false so the rest of the
 * pipeline can fail loud rather than fall back silently.
 */

import { VOICE_ENGINES_SIDECAR_IDS } from "../hardware-tiers";

const DEFAULT_URL = "http://127.0.0.1:4245";

export function voiceCoreUrl(): string {
  return (process.env.VOICE_CORE_URL ?? DEFAULT_URL).replace(/\/+$/, "");
}

/**
 * True when the given model id should be served by voice-core (the only
 * local audio backend).
 */
export function shouldRouteToVoiceCore(modelId: string | null | undefined): boolean {
  if (!modelId) return false;
  return VOICE_ENGINES_SIDECAR_IDS.has(modelId);
}
