import { randomUUID } from "crypto";

import { NextRequest, NextResponse } from "next/server";

import { createArtifact, getUpload } from "@/lib/agui/db";
import { getVoiceAsset, createVoiceReference, listVoiceReferences } from "@/lib/voice/store";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const asset = getVoiceAsset(id);
  if (!asset) {
    return NextResponse.json({ error: "voice asset not found" }, { status: 404 });
  }
  return NextResponse.json({ references: listVoiceReferences(id) });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const asset = getVoiceAsset(id);
  if (!asset) {
    return NextResponse.json({ error: "voice asset not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    uploadId?: string;
    transcript?: string | null;
    speakerName?: string | null;
    sourceType?: "recording" | "upload" | "public_corpus" | "licensed" | "synthetic" | "unknown";
    consentDocument?: string | null;
    qualityScore?: number | null;
  };

  if (!body.uploadId) {
    return NextResponse.json({ error: "uploadId required" }, { status: 400 });
  }

  const upload = getUpload(body.uploadId);
  if (!upload) {
    return NextResponse.json({ error: "upload not found" }, { status: 404 });
  }

  const artifactId = randomUUID();
  createArtifact({
    id: artifactId,
    runId: null,
    threadId: upload.thread_id,
    mimeType: upload.mime_type,
    name: upload.filename || `reference-${artifactId}`,
    url: `/api/upload/${upload.id}`,
    meta: {
      uploadId: upload.id,
      voiceAssetId: id,
      kind: "voice-reference",
    },
  });

  const reference = createVoiceReference({
    id: randomUUID(),
    voiceAssetId: id,
    artifactId,
    transcript: body.transcript ?? null,
    speakerName: body.speakerName ?? null,
    sourceType: body.sourceType ?? "upload",
    consentDocument: body.consentDocument ?? null,
    qualityScore: body.qualityScore ?? null,
  });

  return NextResponse.json({ reference }, { status: 201 });
}
