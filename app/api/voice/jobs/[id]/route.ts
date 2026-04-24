import { NextRequest, NextResponse } from "next/server";

import { getArtifact } from "@/lib/agui/db";
import { getVoiceJob, listVoicePreviewsForJob, ratePreview } from "@/lib/voice/store";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const job = getVoiceJob(id);
  if (!job) {
    return NextResponse.json({ error: "voice job not found" }, { status: 404 });
  }

  const previews = listVoicePreviewsForJob(id).map((preview) => {
    const artifact = getArtifact(preview.artifactId);
    return {
      ...preview,
      artifact: artifact
        ? {
            id: artifact.id,
            name: artifact.name,
            mimeType: artifact.mime_type,
            url: artifact.url,
            createdAt: artifact.created_at,
          }
        : null,
    };
  });

  return NextResponse.json({ job, previews });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    previewId?: string;
    similarity?: number | null;
    quality?: number | null;
    latency?: number | null;
  };

  if (!body.previewId) {
    return NextResponse.json({ error: "previewId required" }, { status: 400 });
  }

  const preview = ratePreview(body.previewId, {
    similarity: body.similarity,
    quality: body.quality,
    latency: body.latency,
  });

  if (!preview) {
    return NextResponse.json({ error: "preview not found" }, { status: 404 });
  }

  return NextResponse.json({ preview });
}
