import { NextRequest, NextResponse } from "next/server";

import { getArtifact } from "@/lib/agui/db";
import { ratePreview } from "@/lib/voice/store";

export const runtime = "nodejs";

interface RatingPayload {
  similarity?: number | null;
  quality?: number | null;
  latency?: number | null;
}

function clamp(value: unknown, min: number, max: number): number | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(max, Math.max(min, n));
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as RatingPayload | null;
  if (!body) {
    return NextResponse.json({ error: "body required" }, { status: 400 });
  }

  const updated = ratePreview(id, {
    similarity: clamp(body.similarity, 1, 5),
    quality: clamp(body.quality, 1, 5),
    latency: clamp(body.latency, 0, 60_000),
  });
  if (!updated) {
    return NextResponse.json({ error: "preview not found" }, { status: 404 });
  }

  const artifact = getArtifact(updated.artifactId);
  return NextResponse.json({
    preview: {
      ...updated,
      artifact: artifact
        ? {
            id: artifact.id,
            name: artifact.name,
            mimeType: artifact.mime_type,
            url: artifact.url,
            createdAt: artifact.created_at,
          }
        : null,
    },
  });
}
