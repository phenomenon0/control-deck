import { NextResponse } from "next/server";

import { ensureBootstrap, getProvider, getSlot } from "@/lib/inference/bootstrap";
import { invokeEmbedding } from "@/lib/inference/embedding/invoke";
import type { EmbeddingArgs } from "@/lib/inference/embedding/types";
import { defaultFor, type LocalPreset } from "@/lib/inference/local-defaults";
import { OLLAMA_BASE_URL, probeOllamaReachable } from "@/lib/inference/ollama-probe";
import type { InferenceProviderConfig } from "@/lib/inference/types";

const VALID_PRESETS = new Set<LocalPreset>(["quick", "balanced", "quality"]);

interface EmbeddingBinding {
  providerId: string;
  config: InferenceProviderConfig;
}

/**
 * When no slot is bound AND no EMBEDDING_PROVIDER is configured, try to
 * fall through to a local Ollama binding using the manifest default for
 * the active preset. The binding is computed per-request (not persisted)
 * so the admin UI still shows "no binding" until the user picks one.
 */
async function resolveEmbedding(preset: LocalPreset): Promise<EmbeddingBinding | null> {
  ensureBootstrap();
  const bound = getSlot("embedding", "primary");
  if (bound) return { providerId: bound.providerId, config: bound.config };

  if (process.env.EMBEDDING_PROVIDER) return null; // configured but bootstrap failed — don't mask

  const manifest = defaultFor("embedding", preset);
  if (manifest.runner !== "ollama" || !manifest.id) return null;

  const reachable = await probeOllamaReachable();
  if (!reachable) return null;

  return {
    providerId: "ollama",
    config: {
      providerId: "ollama",
      baseURL: OLLAMA_BASE_URL,
      model: manifest.id,
    },
  };
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as EmbeddingArgs & {
    preset?: LocalPreset;
  };
  if (!body.input) {
    return NextResponse.json({ error: "input required" }, { status: 400 });
  }

  const preset: LocalPreset =
    body.preset && VALID_PRESETS.has(body.preset) ? body.preset : "balanced";

  const binding = await resolveEmbedding(preset);
  if (!binding) {
    return NextResponse.json(
      { error: "embedding slot not bound — set EMBEDDING_PROVIDER or start Ollama" },
      { status: 501 },
    );
  }

  try {
    const result = await invokeEmbedding(binding.providerId, binding.config, body);
    const info = getProvider(binding.providerId);
    return NextResponse.json(
      {
        vectors: result.vectors,
        dimensions: result.dimensions,
        model: result.model,
        tokens: result.tokens,
        provider: { id: binding.providerId, name: info?.name ?? binding.providerId },
      },
      { headers: { "X-Embedding-Provider": binding.providerId } },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: msg, providerId: binding.providerId }, { status: 502 });
  }
}
