import { NextRequest, NextResponse } from "next/server";

import {
  ensureBootstrap,
  getProvider,
  listProvidersForModality,
} from "@/lib/inference/bootstrap";
import { listVoiceSessions } from "@/lib/voice/store";
import {
  resolveVoiceRoute,
  VOICE_ROUTE_PRESETS,
  type ProviderAvailability,
  type VoiceRoutePreset,
} from "@/lib/voice/resolve-voice-route";

export const runtime = "nodejs";

const VOICE_API_URL = process.env.VOICE_API_URL || "http://localhost:8000";
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

function providerConfigured(id: string): boolean {
  const envKey = API_KEY_ENV[id];
  if (!envKey) return true; // local sidecar etc.
  return Boolean(process.env[envKey]);
}

async function probeSidecar(): Promise<boolean> {
  try {
    const res = await fetch(`${VOICE_API_URL}/health`, {
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

function buildAvailability(modality: "stt" | "tts"): ProviderAvailability[] {
  const list = listProvidersForModality(modality).map((p) => ({
    id: p.id,
    name: p.name,
    configured: providerConfigured(p.id),
    reachable: null as boolean | null,
  }));
  // Always include the local sidecar even though it isn't in the inference
  // registry — it's the offline fallback and must always be considered.
  if (!list.some((p) => p.id === "voice-api")) {
    list.push({ id: "voice-api", name: "Local voice · offline-capable", configured: true, reachable: null });
  }
  return list;
}

export async function GET(req: NextRequest) {
  ensureBootstrap();

  const preset = normalizePreset(req.nextUrl.searchParams.get("preset"));
  const sidecarOk = await probeSidecar();

  const sttAvailability = buildAvailability("stt").map((p) =>
    p.id === "voice-api" ? { ...p, reachable: sidecarOk } : p,
  );
  const ttsAvailability = buildAvailability("tts").map((p) =>
    p.id === "voice-api" ? { ...p, reachable: sidecarOk } : p,
  );

  const resolved = resolveVoiceRoute({
    preset,
    sttProviders: sttAvailability,
    ttsProviders: ttsAvailability,
    sidecarReachable: sidecarOk,
  });

  // Transport: browser never talks to :8000 directly. It always hits /api/voice/*.
  // When the sidecar is absent we still return the URL so Health can display it,
  // but the transport mode tells the client which lane to use.
  const transport = {
    mode: resolved.transport.mode,
    wsUrl: resolved.transport.usesSidecar ? `${VOICE_API_URL.replace(/^http/, "ws")}/ws` : null,
    sidecar: (sidecarOk ? "ok" : "unreachable") as "ok" | "unreachable" | "unknown",
  };

  // Provider matrix for the Health pane: one row per provider per role.
  const matrix = [
    ...sttAvailability.map((p) => ({
      id: p.id,
      name: getProvider(p.id)?.name ?? p.name,
      role: "stt" as const,
      configured: p.configured,
      reachable: p.reachable === true,
      detail: p.id === "voice-api" ? VOICE_API_URL : undefined,
    })),
    ...ttsAvailability.map((p) => ({
      id: p.id,
      name: getProvider(p.id)?.name ?? p.name,
      role: "tts" as const,
      configured: p.configured,
      reachable: p.reachable === true,
      detail: p.id === "voice-api" ? VOICE_API_URL : undefined,
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
      rationale: resolved.rationale,
      stt: resolved.stt,
      tts: resolved.tts,
      fallbacksApplied: resolved.fallbacksApplied,
    },
    transport,
    providers: matrix,
    recentSessions,
    presets: VOICE_ROUTE_PRESETS,
  });
}
