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
  shouldRouteToVoiceCore,
  voiceCoreUrl,
} from "@/lib/inference/voice-core/sidecar-url";
import {
  resolveVoiceRoute,
  VOICE_ROUTE_PRESETS,
  type ProviderAvailability,
  type VoiceRoutePreset,
} from "@/lib/voice/resolve-voice-route";
import { s2sUrl, s2sRealtimeWsUrl } from "@/lib/voice/s2s-url";
import type { SlotBinding } from "@/lib/inference/types";

export const runtime = "nodejs";

const PROBE_TIMEOUT_MS = 1500;
const S2S_BASE_URL = s2sUrl();

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

async function probeHttpHealth(baseURL: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseURL.replace(/\/+$/, "")}/health`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function probeS2sPool(baseURL: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseURL.replace(/\/+$/, "")}/v1/pool`, {
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
  const list = listProvidersForModality(modality).map((p) => ({
    id: p.id,
    name: p.name,
    configured: providerConfigured(p.id, omniReady),
    reachable: null as boolean | null,
  }));
  // Dormant fallback: keep voice-core visible only as a legacy path when a
  // binding still points at it and realtime s2s is unavailable.
  if (!list.some((p) => p.id === "voice-core")) {
    list.push({ id: "voice-core", name: "voice-core · legacy fallback", configured: true, reachable: null });
  }
  return list;
}

export async function GET(req: NextRequest) {
  ensureBootstrap();
  applyPersistedBindings();

  const preset = normalizePreset(req.nextUrl.searchParams.get("preset"));
  const voiceCoreBase = voiceCoreUrl();
  const [voiceCoreOk, s2sOk, omni] = await Promise.all([
    probeHttpHealth(voiceCoreBase),
    probeS2sPool(S2S_BASE_URL),
    getQwenOmniStatusAsync({ probeRuntime: true, probeSidecar: true }),
  ]);

  const sttAvailability = buildAvailability("stt", omni.ready).map((p) =>
    withLocalReachability(p, voiceCoreOk, omni),
  );
  const ttsAvailability = buildAvailability("tts", omni.ready).map((p) =>
    withLocalReachability(p, voiceCoreOk, omni),
  );

  const resolved = resolveVoiceRoute({
    preset,
    sttProviders: sttAvailability,
    ttsProviders: ttsAvailability,
    sidecarReachable: voiceCoreOk,
    s2sReachable: s2sOk,
  });
  const route = applyBoundVoiceSlots(resolved, omni);
  const routeUsesVoiceCore =
    shouldRouteToVoiceCore(route.stt?.model) || shouldRouteToVoiceCore(route.tts?.model);
  const activeWsUrl = routeUsesVoiceCore ? voiceCoreBase.replace(/^http/, "ws") : null;

  const transport = {
    mode: s2sOk ? "realtime" : route.usesSidecar ? "local-sidecar" : resolved.transport.mode,
    wsUrl: s2sOk ? s2sRealtimeWsUrl() : route.usesSidecar ? activeWsUrl : null,
    sidecar: (voiceCoreOk ? "ok" : "unreachable") as "ok" | "unreachable" | "unknown",
  };

  // Provider matrix for the Health pane: one row per provider per role.
  const matrix = [
    ...sttAvailability.map((p) => ({
      id: p.id,
      name: getProvider(p.id)?.name ?? p.name,
      role: "stt" as const,
      configured: p.configured,
      reachable: p.reachable === true,
      detail: p.id === "voice-core" ? voiceCoreBase : p.id === QWEN_OMNI_PROVIDER_ID ? omni.modelDir : undefined,
    })),
    ...ttsAvailability.map((p) => ({
      id: p.id,
      name: getProvider(p.id)?.name ?? p.name,
      role: "tts" as const,
      configured: p.configured,
      reachable: p.reachable === true,
      detail: p.id === "voice-core" ? voiceCoreBase : p.id === QWEN_OMNI_PROVIDER_ID ? omni.modelDir : undefined,
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
  sidecarOk: boolean,
  omni: QwenOmniStatus,
): ProviderAvailability {
  if (provider.id === "voice-core") return { ...provider, reachable: sidecarOk };
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
  const tts = ttsSlot ? { ...bindingToResolved(ttsSlot, "tts"), engine: engineFor(ttsSlot) } : resolved.tts;
  const qwenActive =
    stt?.providerId === QWEN_OMNI_PROVIDER_ID || tts?.providerId === QWEN_OMNI_PROVIDER_ID;
  const omniSidecarOk = omni.sidecar.reachable === true;
  const usesSidecar =
    stt?.providerId === "voice-core" ||
    tts?.providerId === "voice-core" ||
    (qwenActive && !omni.generationReady);
  const rationale = qwenActive
    ? omni.cudaAvailable === true
      ? "Qwen Omni is bound for voice. Local CUDA runtime is available."
      : omniSidecarOk
        ? `Qwen Omni is bound for voice. Routing speech turns through the configured Omni sidecar at ${omni.sidecar.baseURL}.`
        : "Qwen Omni is bound for voice. Full local speech generation needs CUDA or a remote Omni sidecar, so playback/transcription can still fall back to legacy voice-core."
    : resolved.rationale;
  return { stt, tts, usesSidecar, rationale };
}

function bindingToResolved(binding: SlotBinding, modality: "stt" | "tts") {
  const provider = getProvider(binding.providerId);
  return {
    providerId: binding.providerId,
    providerName: provider?.name ?? binding.providerId,
    model: binding.config.model ?? provider?.defaultModels[modality]?.[0] ?? null,
  };
}

function engineFor(binding: SlotBinding): string | null {
  if (binding.providerId === "voice-core") {
    return (binding.config.extras?.engine as string | undefined) ?? "kokoro-82m";
  }
  return null;
}
