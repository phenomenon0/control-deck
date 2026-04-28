/**
 * Route resolver — maps a user-facing preset onto concrete provider bindings.
 *
 * The rest of the UI speaks in product terms (`Local`, `Fast`, `Quality`,
 * `Expressive`, `Offline`). This module is the only place that knows how a
 * preset becomes an actual STT provider, TTS provider, and transport mode.
 *
 * Pure function: all effects (registry lookups, reachability probes) happen
 * upstream and are passed in as a snapshot. Keeps the resolver trivially
 * testable and keeps the runtime endpoint thin.
 */

export type VoiceRoutePreset = "offline" | "local" | "fast" | "quality" | "expressive";

export const VOICE_ROUTE_PRESETS: VoiceRoutePreset[] = [
  "offline",
  "local",
  "fast",
  "quality",
  "expressive",
];

export interface VoiceRoutePresetInfo {
  id: VoiceRoutePreset;
  label: string;
  description: string;
}

export const VOICE_ROUTE_PRESET_INFO: Record<VoiceRoutePreset, VoiceRoutePresetInfo> = {
  offline: {
    id: "offline",
    label: "Offline",
    description: "Local STT + local TTS, no cloud calls.",
  },
  local: {
    id: "local",
    label: "Local",
    description: "Local-first path — privacy-preserving, still uses cloud LLM if configured.",
  },
  fast: {
    id: "fast",
    label: "Fast",
    description: "Fastest configured STT/TTS pair for minimum turn latency.",
  },
  quality: {
    id: "quality",
    label: "Quality",
    description: "Most natural voices, slightly higher latency.",
  },
  expressive: {
    id: "expressive",
    label: "Expressive",
    description: "Voice design / emotional range — premium routing.",
  },
};

export interface ProviderAvailability {
  id: string;
  name: string;
  configured: boolean;
  reachable: boolean | null;
}

export interface ResolverSnapshot {
  preset: VoiceRoutePreset;
  sttProviders: ProviderAvailability[];
  ttsProviders: ProviderAvailability[];
  sidecarReachable: boolean;
}

export interface ResolvedBinding {
  providerId: string;
  providerName: string;
  model: string | null;
}

export interface ResolvedRoute {
  preset: VoiceRoutePreset;
  stt: ResolvedBinding | null;
  tts: (ResolvedBinding & { engine: string | null }) | null;
  transport: {
    mode: "local-sidecar" | "app-gateway" | "realtime";
    usesSidecar: boolean;
  };
  fallbacksApplied: string[];
  rationale: string;
}

const SIDECAR_ID = "voice-core";

/** Preference order per preset. Earlier entries win if available. */
const STT_PREFERENCE: Record<VoiceRoutePreset, string[]> = {
  offline: [SIDECAR_ID],
  local: [SIDECAR_ID, "groq", "deepgram"],
  fast: ["groq", "deepgram", "assemblyai", SIDECAR_ID],
  quality: ["assemblyai", "deepgram", "openai", SIDECAR_ID],
  expressive: ["assemblyai", "deepgram", SIDECAR_ID],
};

const TTS_PREFERENCE: Record<VoiceRoutePreset, string[]> = {
  offline: [SIDECAR_ID],
  local: [SIDECAR_ID, "cartesia", "deepgram"],
  fast: ["cartesia", "deepgram", SIDECAR_ID],
  quality: ["elevenlabs", "google", "cartesia", SIDECAR_ID],
  expressive: ["hume", "elevenlabs", "inworld", SIDECAR_ID],
};

const MODEL_DEFAULTS: Record<string, string | null> = {
  [SIDECAR_ID]: null,
  groq: "whisper-large-v3-turbo",
  deepgram: "nova-3",
  assemblyai: "universal-3-pro",
  openai: "whisper-1",
  cartesia: "sonic-3",
  elevenlabs: "eleven_turbo_v2_5",
  google: "gemini-3.1-flash-preview-tts",
  hume: "octave-2",
  inworld: "inworld-tts-1.5",
};

function pickProvider(
  prefs: string[],
  available: ProviderAvailability[],
  sidecarReachable: boolean,
): { provider: ProviderAvailability; fellBack: boolean } | null {
  const byId = new Map(available.map((p) => [p.id, p]));
  let fellBack = false;
  for (const id of prefs) {
    const entry = byId.get(id);
    if (!entry) continue;
    if (id === SIDECAR_ID) {
      if (sidecarReachable) return { provider: entry, fellBack };
      fellBack = true;
      continue;
    }
    // Consider a cloud provider picked if it's configured (regardless of
    // reachable == null, which means "not probed yet"). If reachable is
    // explicitly false, skip it and fall back.
    if (entry.configured && entry.reachable !== false) {
      return { provider: entry, fellBack };
    }
    fellBack = true;
  }
  return null;
}

export function resolveVoiceRoute(snapshot: ResolverSnapshot): ResolvedRoute {
  const sttPick = pickProvider(
    STT_PREFERENCE[snapshot.preset],
    snapshot.sttProviders,
    snapshot.sidecarReachable,
  );
  const ttsPick = pickProvider(
    TTS_PREFERENCE[snapshot.preset],
    snapshot.ttsProviders,
    snapshot.sidecarReachable,
  );

  const stt: ResolvedBinding | null = sttPick
    ? {
        providerId: sttPick.provider.id,
        providerName: sttPick.provider.name,
        model: MODEL_DEFAULTS[sttPick.provider.id] ?? null,
      }
    : null;

  const tts: (ResolvedBinding & { engine: string | null }) | null = ttsPick
    ? {
        providerId: ttsPick.provider.id,
        providerName: ttsPick.provider.name,
        model: MODEL_DEFAULTS[ttsPick.provider.id] ?? null,
        engine: ttsPick.provider.id === SIDECAR_ID ? "sherpa-onnx-tts" : null,
      }
    : null;

  const fallbacksApplied: string[] = [];
  if (sttPick?.fellBack) fallbacksApplied.push("stt");
  if (ttsPick?.fellBack) fallbacksApplied.push("tts");

  const usesSidecar =
    stt?.providerId === SIDECAR_ID || tts?.providerId === SIDECAR_ID;
  const transportMode: "local-sidecar" | "app-gateway" | "realtime" =
    usesSidecar ? "local-sidecar" : "app-gateway";

  const rationale = buildRationale(snapshot.preset, stt, tts, fallbacksApplied, snapshot);

  return {
    preset: snapshot.preset,
    stt,
    tts,
    transport: { mode: transportMode, usesSidecar },
    fallbacksApplied,
    rationale,
  };
}

function buildRationale(
  preset: VoiceRoutePreset,
  stt: ResolvedBinding | null,
  tts: (ResolvedBinding & { engine: string | null }) | null,
  fallbacks: string[],
  snapshot: ResolverSnapshot,
): string {
  const label = VOICE_ROUTE_PRESET_INFO[preset].label;
  if (!stt && !tts) {
    return `Selected ${label} → no providers reachable. Configure a provider or start the local voice sidecar.`;
  }
  if (fallbacks.length === 0) {
    const sttLabel = stt ? `${stt.providerName}${stt.model ? ` (${stt.model})` : ""}` : "none";
    const ttsLabel = tts ? `${tts.providerName}${tts.model ? ` (${tts.model})` : ""}` : "none";
    return `Selected ${label} → STT ${sttLabel}, TTS ${ttsLabel}.`;
  }
  const reasons: string[] = [];
  if (fallbacks.includes("stt") && stt) {
    const missing = STT_PREFERENCE[preset]
      .filter((id) => id !== stt.providerId)
      .map((id) => snapshot.sttProviders.find((p) => p.id === id))
      .filter((p): p is ProviderAvailability => Boolean(p) && (!p!.configured || p!.reachable === false))
      .map((p) => p.name);
    if (missing.length) reasons.push(`STT fell back from ${missing.join(", ")} to ${stt.providerName}`);
  }
  if (fallbacks.includes("tts") && tts) {
    const missing = TTS_PREFERENCE[preset]
      .filter((id) => id !== tts.providerId)
      .map((id) => snapshot.ttsProviders.find((p) => p.id === id))
      .filter((p): p is ProviderAvailability => Boolean(p) && (!p!.configured || p!.reachable === false))
      .map((p) => p.name);
    if (missing.length) reasons.push(`TTS fell back from ${missing.join(", ")} to ${tts.providerName}`);
  }
  return `Selected ${label} → ${reasons.join("; ") || "resolved with fallbacks"}.`;
}
