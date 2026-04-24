import { NextRequest, NextResponse } from "next/server";

import { getArtifact } from "@/lib/agui/db";
import {
  archiveVoiceAsset,
  publishVoiceAsset,
  restrictVoiceAsset,
} from "@/lib/voice/library";
import {
  getVoiceAsset,
  listVoiceJobs,
  listVoicePreviews,
  listVoiceReferences,
  updateVoiceAsset,
  deleteVoiceAsset,
} from "@/lib/voice/store";

export const runtime = "nodejs";

function hydratePreview(preview: ReturnType<typeof listVoicePreviews>[number]) {
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
}

function hydrateReference(reference: ReturnType<typeof listVoiceReferences>[number]) {
  const artifact = getArtifact(reference.artifactId);
  return {
    ...reference,
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
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const asset = getVoiceAsset(id);
  if (!asset) {
    return NextResponse.json({ error: "voice asset not found" }, { status: 404 });
  }

  const references = listVoiceReferences(id).map(hydrateReference);
  const jobs = listVoiceJobs({ voiceAssetId: id });
  const previews = listVoicePreviews(id).map(hydratePreview);

  return NextResponse.json({ asset, references, jobs, previews });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    action?: "publish" | "restrict" | "archive";
    defaultVoiceId?: string | null;
    description?: string | null;
    styleTags?: string[];
    owner?: string | null;
    consentStatus?: "unknown" | "self_owner" | "licensed" | "consent_on_file" | "public_domain" | "disputed";
    rightsStatus?: "unknown" | "all_rights" | "limited" | "not_for_commercial" | "restricted" | "revoked";
  };

  let asset;
  switch (body.action) {
    case "publish":
      asset = publishVoiceAsset(id);
      break;
    case "restrict":
      asset = restrictVoiceAsset(id);
      break;
    case "archive":
      asset = archiveVoiceAsset(id);
      break;
    default:
      asset = updateVoiceAsset(id, {
        defaultVoiceId: body.defaultVoiceId,
        description: body.description,
        styleTags: body.styleTags,
        owner: body.owner,
        consentStatus: body.consentStatus,
        rightsStatus: body.rightsStatus,
      });
      break;
  }

  if (!asset) {
    return NextResponse.json({ error: "voice asset not found" }, { status: 404 });
  }

  return NextResponse.json({ asset });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const asset = getVoiceAsset(id);
  if (!asset) {
    return NextResponse.json({ error: "voice asset not found" }, { status: 404 });
  }
  deleteVoiceAsset(id);
  return NextResponse.json({ ok: true });
}
