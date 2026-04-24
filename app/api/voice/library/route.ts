import { randomUUID } from "crypto";

import { NextRequest, NextResponse } from "next/server";

import { browseLibrary } from "@/lib/voice/library";
import { getStudioEngine } from "@/lib/voice/providers";
import { createVoiceAsset } from "@/lib/voice/store";

export const runtime = "nodejs";

function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const suffix = randomUUID().slice(0, 8);
  return `${base || "voice"}-${suffix}`;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const includeDrafts = sp.get("includeDrafts") === "1" || sp.get("includeDrafts") === "true";
  const search = sp.get("search") ?? undefined;
  const providerId = sp.get("providerId") ?? undefined;
  const language = sp.get("language") ?? undefined;
  const tag = sp.get("tag") ?? undefined;
  const statusRaw = sp.get("status") ?? undefined;
  const status = statusRaw?.includes(",") ? statusRaw.split(",") : statusRaw;

  const assets = browseLibrary({
    includeDrafts,
    search,
    providerId,
    language,
    tag,
    status: status as never,
  });

  return NextResponse.json({ assets });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    description?: string;
    language?: string | null;
    accent?: string | null;
    gender?: string | null;
    owner?: string | null;
    styleTags?: string[];
    engineId?: string | null;
    providerId?: string | null;
    modelId?: string | null;
    kind?: "native" | "cloned" | "designed" | "fine_tuned" | "imported";
    consentStatus?: "unknown" | "self_owner" | "licensed" | "consent_on_file" | "public_domain" | "disputed";
    rightsStatus?: "unknown" | "all_rights" | "limited" | "not_for_commercial" | "restricted" | "revoked";
  };

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }

  const engine = body.engineId ? getStudioEngine(body.engineId) : undefined;
  const id = randomUUID();
  const asset = createVoiceAsset({
    id,
    name: body.name.trim(),
    slug: slugify(body.name),
    description: body.description?.trim() || null,
    language: body.language ?? null,
    accent: body.accent ?? null,
    gender: body.gender ?? null,
    owner: body.owner ?? null,
    styleTags: body.styleTags ?? [],
    engineId: body.engineId ?? null,
    providerId: body.providerId ?? engine?.providerId ?? null,
    modelId: body.modelId ?? null,
    kind: body.kind ?? "cloned",
    consentStatus: body.consentStatus ?? "unknown",
    rightsStatus: body.rightsStatus ?? "unknown",
    status: "draft",
    meta: {
      recommendedEngine: body.engineId ?? engine?.id ?? null,
    },
  });

  return NextResponse.json({ asset }, { status: 201 });
}
