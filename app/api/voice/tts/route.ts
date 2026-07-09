import { NextResponse } from "next/server";

import { ensureBootstrap, getProvider, getSlot } from "@/lib/inference/bootstrap";
import { applyPersistedBindings } from "@/lib/inference/persistence";
import { invokeTts, listTtsVoices } from "@/lib/inference/tts/invoke";
import { withMetrics } from "@/lib/inference/metrics";
import type { InferenceProviderConfig } from "@/lib/inference/types";
import type { TtsArgs } from "@/lib/inference/tts/types";

interface TtsBinding {
  providerId: string;
  config: InferenceProviderConfig;
}

function resolveTtsBinding(): TtsBinding | null {
  ensureBootstrap();
  applyPersistedBindings();
  const bound = getSlot("tts", "primary");
  if (!bound) return null;
  if (!getProvider(bound.providerId)) return null;
  return { providerId: bound.providerId, config: bound.config };
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    text?: string;
    engine?: string;
    voice?: string;
    model?: string;
    speed?: number;
    format?: TtsArgs["format"];
    preset?: string;
  };

  if (!body.text) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }

  const binding = resolveTtsBinding();
  if (!binding) {
    return NextResponse.json(
      { error: "No text-to-speech provider is bound. Configure a cloud TTS provider or use realtime s2s voice." },
      { status: 503 },
    );
  }

  const { providerId, config } = binding;

  try {
    const result = await withMetrics("tts", providerId, () =>
      invokeTts(providerId, config, {
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
  const binding = resolveTtsBinding();
  if (!binding) {
    return NextResponse.json(
      {
        error: "No text-to-speech provider is bound. Configure a cloud TTS provider or use realtime s2s voice.",
        voices: [],
      },
      { status: 503 },
    );
  }

  const { providerId, config } = binding;

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
