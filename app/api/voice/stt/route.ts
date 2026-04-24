import { NextResponse } from "next/server";

import { ensureBootstrap, getProvider, getSlot } from "@/lib/inference/bootstrap";
import { invokeStt } from "@/lib/inference/stt/invoke";
import { defaultFor, type LocalPreset } from "@/lib/inference/local-defaults";
import { withMetrics } from "@/lib/inference/metrics";
import type { InferenceProviderConfig } from "@/lib/inference/types";

const VALID_PRESETS = new Set<LocalPreset>(["quick", "balanced", "quality"]);

interface SttBinding {
  providerId: string;
  config: InferenceProviderConfig;
  /** True when the resolver fell through to the untyped voice-api default. */
  isFallback: boolean;
}

function resolveSttBinding(): SttBinding {
  ensureBootstrap();
  const bound = getSlot("stt", "primary");
  if (bound) {
    return { providerId: bound.providerId, config: bound.config, isFallback: false };
  }
  return {
    providerId: "voice-api",
    config: {
      providerId: "voice-api",
      baseURL: process.env.VOICE_API_URL ?? "http://localhost:8000",
    },
    isFallback: true,
  };
}

export async function POST(req: Request) {
  const formData = await req.formData();
  const audio = formData.get("audio");

  if (!audio || !(audio instanceof Blob)) {
    return NextResponse.json({ error: "audio file required" }, { status: 400 });
  }

  const language = (formData.get("language") as string | null) ?? undefined;
  const modelParam = (formData.get("model") as string | null) ?? undefined;
  const timestamps = formData.get("timestamps") === "true";
  const mimeType = (formData.get("mimeType") as string | null) ?? undefined;
  const presetRaw = (formData.get("preset") as string | null) ?? undefined;
  const preset: LocalPreset =
    presetRaw && VALID_PRESETS.has(presetRaw as LocalPreset)
      ? (presetRaw as LocalPreset)
      : "balanced";

  const { providerId, config, isFallback } = resolveSttBinding();
  const effectiveLanguage = language ?? (config.extras?.language as string | undefined);

  // Preset-driven hint: only when the caller sent no explicit model AND the
  // slot is unbound. If the sidecar ignores the hint, behaviour is identical
  // to before; if it honours it, preset=quick gets a smaller Whisper.
  const model =
    modelParam ??
    (isFallback && providerId === "voice-api"
      ? defaultFor("stt", preset).id ?? undefined
      : undefined);

  try {
    const result = await withMetrics("stt", providerId, () =>
      invokeStt(providerId, config, {
        audio,
        mimeType,
        language: effectiveLanguage,
        model,
        timestamps,
      }),
      { audioBytes: audio.size },
    );
    const info = getProvider(providerId);
    return NextResponse.json({
      text: result.text,
      language: result.language,
      duration: result.duration,
      words: result.words,
      provider: {
        id: providerId,
        name: info?.name ?? providerId,
      },
    }, {
      headers: { "X-STT-Provider": providerId },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: msg, providerId }, { status: 502 });
  }
}
