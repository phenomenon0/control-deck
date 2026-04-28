import { NextResponse } from "next/server";

import { ensureBootstrap, getProvider, getSlot } from "@/lib/inference/bootstrap";
import { applyPersistedBindings } from "@/lib/inference/persistence";
import { invokeTts, listTtsVoices } from "@/lib/inference/tts/invoke";
import { defaultFor, type LocalPreset } from "@/lib/inference/local-defaults";
import { withMetrics } from "@/lib/inference/metrics";
import type { InferenceProviderConfig } from "@/lib/inference/types";
import type { TtsArgs } from "@/lib/inference/tts/types";

const VALID_PRESETS = new Set<LocalPreset>(["quick", "balanced", "quality"]);

interface TtsBinding {
  providerId: string;
  config: InferenceProviderConfig;
  isFallback: boolean;
}

function resolveTtsBinding(): TtsBinding {
  ensureBootstrap();
  applyPersistedBindings();
  const bound = getSlot("tts", "primary");
  if (bound) {
    return { providerId: bound.providerId, config: bound.config, isFallback: false };
  }
  // Default fallback — preserves pre-slot behaviour for deployments that
  // don't set TTS_PROVIDER.
  return {
    providerId: "voice-core",
    config: {
      providerId: "voice-core",
      baseURL: process.env.VOICE_CORE_URL ?? "http://127.0.0.1:4245",
      extras: { engine: "sherpa-onnx-tts" },
    },
    isFallback: true,
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
    preset?: LocalPreset;
  };

  if (!body.text) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }

  const { providerId, config, isFallback } = resolveTtsBinding();

  const preset: LocalPreset =
    body.preset && VALID_PRESETS.has(body.preset) ? body.preset : "balanced";

  // Preset → sidecar engine when caller sent nothing explicit AND we fell
  // through to the voice-core default. The manifest maps
  // quick=sherpa-onnx-tts, balanced=kokoro-82m, quality=chatterbox — falls
  // back to "sherpa-onnx-tts" if the manifest entry lacks an id (Kokoro is
  // unreliable in some setups; sherpa-onnx VITS is the safe default).
  const presetEngine =
    isFallback && providerId === "voice-core" && !body.engine
      ? defaultFor("tts", preset).id ?? "sherpa-onnx-tts"
      : body.engine;

  // Per-request engine override (voice-core only) — keeps the settings UI's
  // engine toggle working, and also plumbs the preset-derived engine when the
  // client didn't pin one. Override BOTH config.model and extras.engine so
  // invokeVoiceCore's `args.model ?? config.model ?? extras.engine` priority
  // can't fall back to the persisted binding's stale model id.
  const effectiveConfig: InferenceProviderConfig =
    presetEngine && providerId === "voice-core"
      ? {
          ...config,
          model: presetEngine,
          extras: { ...(config.extras ?? {}), engine: presetEngine },
        }
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
