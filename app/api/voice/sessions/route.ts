import { randomUUID } from "crypto";

import { NextRequest, NextResponse } from "next/server";

import { createVoiceSession, listVoiceSessions } from "@/lib/voice/store";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const threadId = req.nextUrl.searchParams.get("threadId") ?? undefined;
  const sessions = listVoiceSessions(threadId);
  return NextResponse.json({ sessions });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    threadId?: string | null;
    runId?: string | null;
    sttProviderId?: string | null;
    ttsProviderId?: string | null;
    voiceAssetId?: string | null;
    mode?: "push_to_talk" | "toggle" | "vad" | "continuous" | "full_duplex";
    latencySummary?: Record<string, number>;
    meta?: Record<string, unknown>;
  };

  const session = createVoiceSession({
    id: randomUUID(),
    threadId: body.threadId ?? null,
    runId: body.runId ?? null,
    sttProviderId: body.sttProviderId ?? null,
    ttsProviderId: body.ttsProviderId ?? null,
    voiceAssetId: body.voiceAssetId ?? null,
    mode: body.mode ?? "push_to_talk",
    latencySummary: body.latencySummary,
    meta: body.meta,
  });

  return NextResponse.json({ session }, { status: 201 });
}
