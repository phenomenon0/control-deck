/**
 * Voice-engines sidecar URL resolution.
 *
 * The new in-repo Python sidecar at `scripts/voice-engines-sidecar.py` hosts
 * Kokoro / Orpheus / Moonshine / Parakeet / Moshi / whisper.cpp. It's the
 * second voice sidecar in the project — `voice-api` (port 8000, legacy) keeps
 * Piper / xtts / chatterbox / faster-whisper, and `qwen-omni-sidecar.py`
 * (port 9100) keeps the omni model.
 *
 * Routing rule: if the slot-bound model id is in `VOICE_ENGINES_SIDECAR_IDS`
 * (declared in `lib/inference/hardware-tiers.ts`) the request goes to port
 * 9101; otherwise the legacy `voice-api` URL is used. This lets the existing
 * `voice-api` provider entry serve both sidecars without forking the
 * provider registry.
 */

import { VOICE_ENGINES_SIDECAR_IDS } from "../hardware-tiers";

const DEFAULT_URL = "http://127.0.0.1:9101";

export function voiceEnginesSidecarUrl(): string {
  return (process.env.VOICE_ENGINES_URL ?? DEFAULT_URL).replace(/\/+$/, "");
}

/**
 * True when the given model id should be served by the new voice-engines
 * sidecar (port 9101) rather than the legacy `voice-api` (port 8000).
 */
export function shouldRouteToVoiceEngines(modelId: string | null | undefined): boolean {
  if (!modelId) return false;
  return VOICE_ENGINES_SIDECAR_IDS.has(modelId);
}
