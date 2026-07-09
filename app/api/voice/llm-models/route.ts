/**
 * GET /api/voice/llm-models?provider=<ollama|llamacpp|vllm|lm-studio>
 *
 * Server-side model listing for the Voice Lab's LLM endpoint picker. Resolves
 * the engine URL through resolveProviderUrl (settings > env > default) so the
 * picker honors Settings > Hardware overrides, and the browser never has to
 * reach the engine cross-origin. An unreachable engine is a 200 with
 * reachable:false so the UI can degrade to free-text model entry.
 */

import { NextResponse } from "next/server";

import { resolveProviderUrl } from "@/lib/hardware/settings";
import type { SettingsProviderId } from "@/lib/settings/schema";
import {
  LLM_MODEL_PROVIDERS,
  openAiBaseUrl,
  type LlmModelsProvider,
} from "@/lib/voice-lab/llm-endpoints";

export const runtime = "nodejs";

const PROBE_TIMEOUT_MS = 1500;

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("provider");
  if (!raw || !(LLM_MODEL_PROVIDERS as readonly string[]).includes(raw)) {
    return NextResponse.json(
      { error: `provider must be one of: ${LLM_MODEL_PROVIDERS.join(", ")}` },
      { status: 400 },
    );
  }
  const provider = raw as LlmModelsProvider;
  const resolved = resolveProviderUrl(provider as SettingsProviderId).replace(/\/+$/, "");
  const baseUrl = openAiBaseUrl(resolved);

  try {
    const models = provider === "ollama" ? await listOllamaModels(resolved) : await listOpenAiModels(baseUrl);
    return NextResponse.json({ provider, baseUrl, models, reachable: true });
  } catch {
    return NextResponse.json({ provider, baseUrl, models: [], reachable: false });
  }
}

async function listOllamaModels(base: string): Promise<string[]> {
  const root = base.replace(/\/v1$/, "");
  const res = await fetch(`${root}/api/tags`, {
    cache: "no-store",
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`ollama tags: ${res.status}`);
  const data = (await res.json()) as { models?: Array<{ name?: unknown }> };
  return normalizeNames((data.models ?? []).map((m) => m.name));
}

async function listOpenAiModels(baseUrl: string): Promise<string[]> {
  const res = await fetch(`${baseUrl}/models`, {
    cache: "no-store",
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`models: ${res.status}`);
  const data = (await res.json()) as { data?: Array<{ id?: unknown }> };
  return normalizeNames((data.data ?? []).map((m) => m.id));
}

function normalizeNames(values: unknown[]): string[] {
  return values
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .sort((a, b) => a.localeCompare(b));
}
