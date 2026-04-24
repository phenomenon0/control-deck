import { NextRequest, NextResponse } from "next/server";

import { startVoiceJob } from "@/lib/voice/jobs";
import { listVoiceJobs } from "@/lib/voice/store";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const voiceAssetId = sp.get("voiceAssetId") ?? undefined;
  const statusRaw = sp.get("status") ?? undefined;
  const status = statusRaw?.includes(",") ? statusRaw.split(",") : statusRaw;
  const jobType = sp.get("jobType") ?? undefined;

  const jobs = listVoiceJobs({
    voiceAssetId,
    status: status as never,
    jobType: jobType as never,
  });

  return NextResponse.json({ jobs });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    voiceAssetId?: string;
    jobType?: "clone" | "fine_tune" | "design" | "preview" | "segment" | "transcribe" | "evaluate";
    engineId?: string;
    providerId?: string;
    modelId?: string;
    threadId?: string;
    text?: string;
    params?: Record<string, unknown>;
  };

  if (!body.voiceAssetId) {
    return NextResponse.json({ error: "voiceAssetId required" }, { status: 400 });
  }

  const job = await startVoiceJob({
    voiceAssetId: body.voiceAssetId,
    jobType: body.jobType ?? "preview",
    engineId: body.engineId,
    providerId: body.providerId,
    modelId: body.modelId,
    threadId: body.threadId ?? "voice-studio",
    input: {
      text: body.text,
      params: body.params,
    },
  });

  return NextResponse.json({ job }, { status: 201 });
}
