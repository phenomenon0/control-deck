import { NextResponse } from "next/server";

import { ensureBootstrap, getProvider, getSlot } from "@/lib/inference/bootstrap";
import { invokeTts, listTtsVoices } from "@/lib/inference/tts/invoke";
import { withMetrics } from "@/lib/inference/metrics";
import type { InferenceProviderConfig } from "@/lib/inference/types";
import type { TtsArgs } from "@/lib/inference/tts/types";

function resolveTtsBinding(): {
  providerId: string;
  config: InferenceProviderConfig;
} {
  ensureBootstrap();
  const bound = getSlot("tts", "primary");
  if (bound) return { providerId: bound.providerId, config: bound.config };
  // Default fallback — preserves pre-slot behaviour for deployments that
  // don't set TTS_PROVIDER.
  return {
    providerId: "voice-api",
    config: {
      providerId: "voice-api",
      baseURL: process.env.VOICE_API_URL ?? "http://localhost:8000",
      extras: { engine: "piper" },
    },
  };
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    text?: string;
    engine?: string;
    voice?: string;
    model?: string;
    speed?: number;
    format?: TtsArgs["format"];
  };

  if (!body.text) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }

  const { providerId, config } = resolveTtsBinding();

  // Per-request engine override (voice-api only) — keeps the settings UI's
  // Piper/xtts/chatterbox toggle working.
  const effectiveConfig: InferenceProviderConfig =
    body.engine && providerId === "voice-api"
      ? { ...config, extras: { ...(config.extras ?? {}), engine: body.engine } }
      : config;

  try {
    const result = await withMetrics("tts", providerId, () =>
      invokeTts(providerId, effectiveConfig, {
        text: body.text!,
        voice: body.voice,
        model: body.model,
        speed: body.speed,
        format: body.format,
      }),
      { textLength: body.text.length },
    );

    return new Response(result.audio, {
      headers: {
        "Content-Type": result.contentType,
        "Content-Disposition": 'inline; filename="speech.audio"',
        "X-TTS-Provider": result.providerId,
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: msg, providerId }, { status: 502 });
  }
}

export async function GET() {
  const { providerId, config } = resolveTtsBinding();

  try {
    const voices = await listTtsVoices(providerId, config);
    const info = getProvider(providerId);
    return NextResponse.json({
      provider: {
        id: providerId,
        name: info?.name ?? providerId,
      },
      voices,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: msg, voices: [] }, { status: 502 });
  }
}
