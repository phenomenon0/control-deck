import { NextResponse } from "next/server";

import { ensureBootstrap, getProvider, getSlot } from "@/lib/inference/bootstrap";
import { invokeStt } from "@/lib/inference/stt/invoke";
import { withMetrics } from "@/lib/inference/metrics";
import type { InferenceProviderConfig } from "@/lib/inference/types";

function resolveSttBinding(): {
  providerId: string;
  config: InferenceProviderConfig;
} {
  ensureBootstrap();
  const bound = getSlot("stt", "primary");
  if (bound) return { providerId: bound.providerId, config: bound.config };
  return {
    providerId: "voice-api",
    config: {
      providerId: "voice-api",
      baseURL: process.env.VOICE_API_URL ?? "http://localhost:8000",
    },
  };
}

export async function POST(req: Request) {
  const formData = await req.formData();
  const audio = formData.get("audio");

  if (!audio || !(audio instanceof Blob)) {
    return NextResponse.json({ error: "audio file required" }, { status: 400 });
  }

  const language = (formData.get("language") as string | null) ?? undefined;
  const model = (formData.get("model") as string | null) ?? undefined;
  const timestamps = formData.get("timestamps") === "true";
  const mimeType = (formData.get("mimeType") as string | null) ?? undefined;

  const { providerId, config } = resolveSttBinding();
  const effectiveLanguage = language ?? (config.extras?.language as string | undefined);

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
