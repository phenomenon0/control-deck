import { NextRequest, NextResponse } from "next/server";

import {
  ensureBootstrap,
  getProvider,
  getSlot,
  listProvidersForModality,
} from "@/lib/inference/bootstrap";
import { applyPersistedBindings } from "@/lib/inference/persistence";
import { listVoiceSessions } from "@/lib/voice/store";
import {
  getQwenOmniStatusAsync,
  QWEN_OMNI_PROVIDER_ID,
  type QwenOmniStatus,
} from "@/lib/inference/omni/local";
import {
  resolveVoiceRoute,
  VOICE_ROUTE_PRESETS,
  type ProviderAvailability,
  type VoiceRoutePreset,
} from "@/lib/voice/resolve-voice-route";
import { voiceAgentToken, voiceAgentUiUrl, voiceAgentWsUrl } from "@/lib/voice/voice-agent-url";
import type { SlotBinding } from "@/lib/inference/types";

export const runtime = "nodejs";

const PROBE_TIMEOUT_MS = 1500;

/**
 * Environment variables the registry uses to decide "configured". Kept in one
 * place so the UI Health pane matches resolver decisions.
 */
const API_KEY_ENV: Record<string, string> = {
  elevenlabs: "ELEVENLABS_API_KEY",
  openai: "OPENAI_API_KEY",
  cartesia: "CARTESIA_API_KEY",
  groq: "GROQ_API_KEY",
  deepgram: "DEEPGRAM_API_KEY",
  hume: "HUME_API_KEY",
  inworld: "INWORLD_API_KEY",
  assemblyai: "ASSEMBLYAI_API_KEY",
  google: "GOOGLE_API_KEY",
};

function providerConfigured(id: string, omniReady: boolean): boolean {
  if (id === QWEN_OMNI_PROVIDER_ID) return omniReady;
  const envKey = API_KEY_ENV[id];
  if (!envKey) return true; // local sidecar etc.
  return Boolean(process.env[envKey]);
}

/** The agent has no health route; its UI server answering is the liveness signal. */
async function probeVoiceAgent(): Promise<boolean> {
  try {
    const res = await fetch(`${voiceAgentUiUrl().replace(/\/+$/, "")}/`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function normalizePreset(raw: string | null): VoiceRoutePreset {
  if (raw && (VOICE_ROUTE_PRESETS as string[]).includes(raw)) return raw as VoiceRoutePreset;
  return "local";
}

function buildAvailability(modality: "stt" | "tts", omniReady: boolean): ProviderAvailability[] {
  return listProvidersForModality(modality).map((p) => ({
    id: p.id,
    name: p.name,
    configured: providerConfigured(p.id, omniReady),
    reachable: null as boolean | null,
  }));
}

export async function GET(req: NextRequest) {
  ensureBootstrap();
  applyPersistedBindings();

  const preset = normalizePreset(req.nextUrl.searchParams.get("preset"));
  const [agentOk, omni] = await Promise.all([
    probeVoiceAgent(),
    getQwenOmniStatusAsync({ probeRuntime: true, probeSidecar: true }),
  ]);

  const sttAvailability = buildAvailability("stt", omni.ready).map((p) =>
    withLocalReachability(p, omni),
  );
  const ttsAvailability = buildAvailability("tts", omni.ready).map((p) =>
    withLocalReachability(p, omni),
  );

  const resolved = resolveVoiceRoute({
    preset,
    sttProviders: sttAvailability,
    ttsProviders: ttsAvailability,
    voiceAgentReachable: agentOk,
  });
  const route = applyBoundVoiceSlots(resolved, omni);

  const transport = {
    mode: agentOk ? "realtime" : "app-gateway",
    wsUrl: agentOk ? voiceAgentWsUrl() : null,
    // Shared local secret, same one the agent's own UI page uses.
    token: agentOk ? voiceAgentToken() : null,
    sidecar: (agentOk ? "ok" : "unreachable") as "ok" | "unreachable" | "unknown",
  };

  // Provider matrix for the Health pane: one row per provider per role.
  const matrix = [
    ...sttAvailability.map((p) => ({
      id: p.id,
      name: getProvider(p.id)?.name ?? p.name,
      role: "stt" as const,
      configured: p.configured,
      reachable: p.reachable === true,
      detail: p.id === QWEN_OMNI_PROVIDER_ID ? omni.modelDir : undefined,
    })),
    ...ttsAvailability.map((p) => ({
      id: p.id,
      name: getProvider(p.id)?.name ?? p.name,
      role: "tts" as const,
      configured: p.configured,
      reachable: p.reachable === true,
      detail: p.id === QWEN_OMNI_PROVIDER_ID ? omni.modelDir : undefined,
    })),
  ];

  const recentSessions = listVoiceSessions(undefined, 10).map((s) => ({
    id: s.id,
    createdAt: s.createdAt,
    mode: s.mode,
    latencySummary: s.latencySummary ?? null,
  }));

  return NextResponse.json({
    route: {
      preset: resolved.preset,
      rationale: route.rationale,
      stt: route.stt,
      tts: route.tts,
      fallbacksApplied: resolved.fallbacksApplied,
    },
    omni,
    transport,
    providers: matrix,
    recentSessions,
    presets: VOICE_ROUTE_PRESETS,
  });
}

function withLocalReachability(
  provider: ProviderAvailability,
  omni: QwenOmniStatus,
): ProviderAvailability {
  if (provider.id === QWEN_OMNI_PROVIDER_ID) return { ...provider, reachable: omni.generationReady };
  return provider;
}

function applyBoundVoiceSlots(
  resolved: ReturnType<typeof resolveVoiceRoute>,
  omni: QwenOmniStatus,
) {
  const sttSlot = getSlot("stt", "primary");
  const ttsSlot = getSlot("tts", "primary");
  const stt = sttSlot ? bindingToResolved(sttSlot, "stt") : resolved.stt;
  const ttsBinding = ttsSlot ? bindingToResolved(ttsSlot, "tts") : null;
  const tts = ttsSlot ? (ttsBinding ? { ...ttsBinding, engine: null } : null) : resolved.tts;
  const qwenActive =
    stt?.providerId === QWEN_OMNI_PROVIDER_ID || tts?.providerId === QWEN_OMNI_PROVIDER_ID;
  const omniSidecarOk = omni.sidecar.reachable === true;
  const rationale = qwenActive
    ? omni.cudaAvailable === true
      ? "Qwen Omni is bound for voice. Local CUDA runtime is available."
      : omniSidecarOk
        ? `Qwen Omni is bound for voice. Routing speech turns through the configured Omni sidecar at ${omni.sidecar.baseURL}.`
        : "Qwen Omni is bound for voice. Full local speech generation needs CUDA or a remote Omni sidecar."
    : resolved.rationale;
  return { stt, tts, rationale };
}

function bindingToResolved(binding: SlotBinding, modality: "stt" | "tts") {
  const provider = getProvider(binding.providerId);
  if (!provider) return null;
  return {
    providerId: binding.providerId,
    providerName: provider?.name ?? binding.providerId,
    model: binding.config.model ?? provider?.defaultModels[modality]?.[0] ?? null,
  };
}
