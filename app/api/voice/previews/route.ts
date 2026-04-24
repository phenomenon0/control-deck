import { NextRequest, NextResponse } from "next/server";

import { getArtifact } from "@/lib/agui/db";
import { listVoicePreviews, listVoicePreviewsForJob } from "@/lib/voice/store";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const voiceAssetId = req.nextUrl.searchParams.get("voiceAssetId");
  const jobId = req.nextUrl.searchParams.get("jobId");

  if (!voiceAssetId && !jobId) {
    return NextResponse.json({ error: "voiceAssetId or jobId required" }, { status: 400 });
  }

  const previews = (jobId ? listVoicePreviewsForJob(jobId) : listVoicePreviews(voiceAssetId!)).map((preview) => {
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

  return NextResponse.json({ previews });
}
