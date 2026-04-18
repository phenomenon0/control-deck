import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createRun, errorRun, finishRun } from "@/lib/agui/db";
import { generateId } from "@/lib/agui/events";
import { executeComfyWorkflow } from "@/lib/tools/comfy";
import { loadWorkflow } from "@/lib/tools/workflows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIVE_SAMPLE_LOADERS = {
  "stable-audio": {
    recommended: true,
    workflow: "stable-audio",
    model: "stable-audio-open-1.0.safetensors",
    clip: "t5-base.safetensors",
    nodes: ["CheckpointLoaderSimple", "CLIPLoader", "KSampler", "VAEDecodeAudio", "SaveAudioMP3"],
    bestFor: "track loops, one-shots, beds, and deck-ready textures",
  },
  "ace-step": {
    recommended: false,
    workflow: "ace-step",
    model: "ace-step-v1.5.safetensors",
    nodes: ["ACEStepModelLoader", "ACEStepSampler", "SaveAudioMP3"],
    bestFor: "song-like clips when ACE-Step custom nodes and model files are installed",
  },
} as const;

const LiveSampleRequestSchema = z.object({
  track: z.number().int().min(0).max(7),
  prompt: z.string().trim().min(1).max(600),
  duration: z.number().min(1).max(47).default(8),
  seed: z.number().int().min(0).optional(),
  name: z.string().trim().max(32).optional(),
  loader: z.enum(["stable-audio", "ace-step"]).default("stable-audio"),
});

const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 6;
const hits = new Map<string, number[]>();

function rateLimitKey(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? req.headers.get("x-real-ip")
    ?? "local";
}

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((ts) => now - ts < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  return false;
}

export async function GET() {
  return NextResponse.json({
    recommended: "stable-audio",
    loaders: LIVE_SAMPLE_LOADERS,
  });
}

export async function POST(req: NextRequest) {
  const key = rateLimitKey(req);
  if (isRateLimited(key)) {
    return NextResponse.json(
      { error: "Too many sample generation requests. Try again in a minute." },
      { status: 429 },
    );
  }

  let input: z.infer<typeof LiveSampleRequestSchema>;
  try {
    input = LiveSampleRequestSchema.parse(await req.json());
  } catch (error) {
    const detail = error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join("; ")
      : "Invalid JSON body";
    return NextResponse.json({ error: "Invalid sample request", detail }, { status: 400 });
  }

  const threadId = "live";
  const runId = generateId();
  const toolCallId = generateId();
  const seed = input.seed ?? Math.floor(Math.random() * 1_000_000_000);

  createRun(runId, threadId, `live-sample:${input.loader}`);

  try {
    const workflow = loadWorkflow(input.loader, {
      prompt: input.prompt,
      duration: input.duration,
      seed,
    });

    const result = await executeComfyWorkflow(
      workflow,
      `live_sample_t${input.track}_${Date.now()}`,
      { threadId, runId, toolCallId },
      input.loader,
    );

    if (result.status === "success" && result.artifacts?.length) {
      finishRun(runId);
      return NextResponse.json({
        success: true,
        track: input.track,
        name: input.name,
        loader: input.loader,
        model: LIVE_SAMPLE_LOADERS[input.loader],
        seed,
        artifacts: result.artifacts,
      });
    }

    if (result.status === "queued") {
      finishRun(runId);
      return NextResponse.json({
        success: true,
        queued: true,
        track: input.track,
        loader: input.loader,
        promptId: result.promptId,
        note: result.note,
      });
    }

    const message = result.error ?? "Sample generation failed";
    errorRun(runId, message);
    return NextResponse.json(
      { error: "Sample generation failed", detail: message },
      { status: 500 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sample generation failed";
    errorRun(runId, message);
    return NextResponse.json(
      { error: "Sample generation failed", detail: message },
      { status: 500 },
    );
  }
}
