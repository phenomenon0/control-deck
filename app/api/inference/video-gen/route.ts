import { NextResponse } from "next/server";

import { ensureBootstrap, getProvider, getSlot } from "@/lib/inference/bootstrap";
import { invokeVideoGen } from "@/lib/inference/video-gen/invoke";
import type { VideoGenArgs } from "@/lib/inference/video-gen/types";

export async function POST(req: Request) {
  ensureBootstrap();
  const bound = getSlot("video-gen", "primary");
  if (!bound) {
    return NextResponse.json(
      { error: "video-gen slot not bound — set VIDEO_GEN_PROVIDER" },
      { status: 501 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as VideoGenArgs;
  try {
    const result = await invokeVideoGen(bound.providerId, bound.config, body);
    const info = getProvider(bound.providerId);
    return NextResponse.json(
      {
        videoUrl: result.videoUrl,
        mime: result.mime,
        previewUrl: result.previewUrl,
        provider: { id: bound.providerId, name: info?.name ?? bound.providerId },
      },
      { headers: { "X-Video-Gen-Provider": bound.providerId } },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: msg, providerId: bound.providerId }, { status: 502 });
  }
}
