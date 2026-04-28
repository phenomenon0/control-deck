import { NextResponse } from "next/server";

import { voiceCoreUrl } from "@/lib/inference/voice-core/sidecar-url";

/**
 * Voice subsystem health probe.
 *
 * Reports a matrix of TTS + STT providers so the UI can show the user which
 * engines are actually reachable right now. Each probe is best-effort:
 *  - `configured` means the relevant API key env var is set
 *  - `reachable` means a lightweight request completed in time
 *  - `detail` surfaces the first reachable response payload or error shape
 */

const PROBE_TIMEOUT_MS = 3000;

interface ProviderHealth {
  id: string;
  modalities: Array<"tts" | "stt">;
  configured: boolean;
  reachable: boolean | null;
  detail?: string;
  latencyMs?: number;
}

async function probe(
  signal: AbortSignal,
  fn: () => Promise<Response | null>,
): Promise<{ reachable: boolean; detail?: string; latencyMs: number }> {
  const started = Date.now();
  try {
    const res = await fn();
    const latencyMs = Date.now() - started;
    if (!res) return { reachable: false, detail: "no response", latencyMs };
    if (res.ok) return { reachable: true, latencyMs };
    return {
      reachable: false,
      detail: `http ${res.status}`,
      latencyMs,
    };
  } catch (err) {
    return {
      reachable: false,
      detail: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - started,
    };
  } finally {
    void signal;
  }
}

function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
}

async function probeVoiceCore(): Promise<ProviderHealth> {
  const res = await probe(AbortSignal.timeout(PROBE_TIMEOUT_MS), () =>
    fetchWithTimeout(`${voiceCoreUrl()}/health`).catch(() => null),
  );
  return {
    id: "voice-core",
    modalities: ["tts", "stt"],
    configured: true, // local sidecar — always considered configured
    reachable: res.reachable,
    detail: res.detail,
    latencyMs: res.latencyMs,
  };
}

async function probeElevenLabs(): Promise<ProviderHealth> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    return { id: "elevenlabs", modalities: ["tts"], configured: false, reachable: null };
  }
  const res = await probe(AbortSignal.timeout(PROBE_TIMEOUT_MS), () =>
    fetchWithTimeout("https://api.elevenlabs.io/v1/user", {
      headers: { "xi-api-key": key },
    }).catch(() => null),
  );
  return {
    id: "elevenlabs",
    modalities: ["tts"],
    configured: true,
    reachable: res.reachable,
    detail: res.detail,
    latencyMs: res.latencyMs,
  };
}

async function probeOpenAi(): Promise<ProviderHealth> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return { id: "openai", modalities: ["tts", "stt"], configured: false, reachable: null };
  }
  const res = await probe(AbortSignal.timeout(PROBE_TIMEOUT_MS), () =>
    fetchWithTimeout("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
    }).catch(() => null),
  );
  return {
    id: "openai",
    modalities: ["tts", "stt"],
    configured: true,
    reachable: res.reachable,
    detail: res.detail,
    latencyMs: res.latencyMs,
  };
}

async function probeCartesia(): Promise<ProviderHealth> {
  const key = process.env.CARTESIA_API_KEY;
  if (!key) {
    return { id: "cartesia", modalities: ["tts", "stt"], configured: false, reachable: null };
  }
  const res = await probe(AbortSignal.timeout(PROBE_TIMEOUT_MS), () =>
    fetchWithTimeout("https://api.cartesia.ai/voices", {
      headers: { "X-API-Key": key, "Cartesia-Version": "2024-06-10" },
    }).catch(() => null),
  );
  return {
    id: "cartesia",
    modalities: ["tts", "stt"],
    configured: true,
    reachable: res.reachable,
    detail: res.detail,
    latencyMs: res.latencyMs,
  };
}

async function probeGroq(): Promise<ProviderHealth> {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    return { id: "groq", modalities: ["stt"], configured: false, reachable: null };
  }
  const res = await probe(AbortSignal.timeout(PROBE_TIMEOUT_MS), () =>
    fetchWithTimeout("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
    }).catch(() => null),
  );
  return {
    id: "groq",
    modalities: ["stt"],
    configured: true,
    reachable: res.reachable,
    detail: res.detail,
    latencyMs: res.latencyMs,
  };
}

async function probeDeepgram(): Promise<ProviderHealth> {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) {
    return { id: "deepgram", modalities: ["stt", "tts"], configured: false, reachable: null };
  }
  const res = await probe(AbortSignal.timeout(PROBE_TIMEOUT_MS), () =>
    fetchWithTimeout("https://api.deepgram.com/v1/projects", {
      headers: { Authorization: `Token ${key}` },
    }).catch(() => null),
  );
  return {
    id: "deepgram",
    modalities: ["stt", "tts"],
    configured: true,
    reachable: res.reachable,
    detail: res.detail,
    latencyMs: res.latencyMs,
  };
}

async function probeHume(): Promise<ProviderHealth> {
  const key = process.env.HUME_API_KEY;
  if (!key) {
    return { id: "hume", modalities: ["tts"], configured: false, reachable: null };
  }
  const res = await probe(AbortSignal.timeout(PROBE_TIMEOUT_MS), () =>
    fetchWithTimeout("https://api.hume.ai/v0/tts/voices?provider=HUME_AI", {
      headers: { "X-Hume-Api-Key": key },
    }).catch(() => null),
  );
  return {
    id: "hume",
    modalities: ["tts"],
    configured: true,
    reachable: res.reachable,
    detail: res.detail,
    latencyMs: res.latencyMs,
  };
}

async function probeInworld(): Promise<ProviderHealth> {
  const key = process.env.INWORLD_API_KEY;
  if (!key) {
    return { id: "inworld", modalities: ["tts"], configured: false, reachable: null };
  }
  const res = await probe(AbortSignal.timeout(PROBE_TIMEOUT_MS), () =>
    fetchWithTimeout("https://api.inworld.ai/tts/v1/voices", {
      headers: { Authorization: `Basic ${key}` },
    }).catch(() => null),
  );
  return {
    id: "inworld",
    modalities: ["tts"],
    configured: true,
    reachable: res.reachable,
    detail: res.detail,
    latencyMs: res.latencyMs,
  };
}

async function probeAssemblyAi(): Promise<ProviderHealth> {
  const key = process.env.ASSEMBLYAI_API_KEY;
  if (!key) {
    return { id: "assemblyai", modalities: ["stt"], configured: false, reachable: null };
  }
  const res = await probe(AbortSignal.timeout(PROBE_TIMEOUT_MS), () =>
    fetchWithTimeout("https://api.assemblyai.com/v2/account", {
      headers: { authorization: key },
    }).catch(() => null),
  );
  return {
    id: "assemblyai",
    modalities: ["stt"],
    configured: true,
    reachable: res.reachable,
    detail: res.detail,
    latencyMs: res.latencyMs,
  };
}

export async function GET() {
  const providers = await Promise.all([
    probeVoiceCore(),
    probeElevenLabs(),
    probeOpenAi(),
    probeCartesia(),
    probeGroq(),
    probeDeepgram(),
    probeHume(),
    probeInworld(),
    probeAssemblyAi(),
  ]);

  const reachable = providers.filter((p) => p.reachable === true).map((p) => p.id);
  const unreachable = providers
    .filter((p) => p.configured && p.reachable === false)
    .map((p) => p.id);
  const unconfigured = providers.filter((p) => !p.configured).map((p) => p.id);

  // Back-compat: keep the existing `status` shape so older callers don't break.
  const sidecar = providers.find((p) => p.id === "voice-core");
  const anyReachable = reachable.length > 0;
  const status = anyReachable ? "ok" : "degraded";

  return NextResponse.json({
    status,
    sidecar: sidecar?.reachable ? "ok" : "unreachable",
    providers,
    summary: { reachable, unreachable, unconfigured },
  });
}
