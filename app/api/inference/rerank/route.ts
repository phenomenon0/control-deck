import { NextResponse } from "next/server";

import { ensureBootstrap, getProvider, getSlot } from "@/lib/inference/bootstrap";
import { invokeRerank } from "@/lib/inference/rerank/invoke";
import type { RerankArgs } from "@/lib/inference/rerank/types";

export async function POST(req: Request) {
  ensureBootstrap();
  const bound = getSlot("rerank", "primary");
  if (!bound) {
    return NextResponse.json(
      { error: "rerank slot not bound — set RERANK_PROVIDER" },
      { status: 501 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as RerankArgs;
  if (!body.query || !Array.isArray(body.documents)) {
    return NextResponse.json({ error: "query and documents[] required" }, { status: 400 });
  }

  try {
    const result = await invokeRerank(bound.providerId, bound.config, body);
    const info = getProvider(bound.providerId);
    return NextResponse.json(
      {
        results: result.results,
        model: result.model,
        provider: { id: bound.providerId, name: info?.name ?? bound.providerId },
      },
      { headers: { "X-Rerank-Provider": bound.providerId } },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: msg, providerId: bound.providerId }, { status: 502 });
  }
}
