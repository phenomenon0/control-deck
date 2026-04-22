import { NextResponse } from "next/server";

import { ensureBootstrap, getProvider, getSlot } from "@/lib/inference/bootstrap";
import { invokeEmbedding } from "@/lib/inference/embedding/invoke";
import type { EmbeddingArgs } from "@/lib/inference/embedding/types";

export async function POST(req: Request) {
  ensureBootstrap();
  const bound = getSlot("embedding", "primary");
  if (!bound) {
    return NextResponse.json(
      { error: "embedding slot not bound — set EMBEDDING_PROVIDER" },
      { status: 501 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as EmbeddingArgs;
  if (!body.input) {
    return NextResponse.json({ error: "input required" }, { status: 400 });
  }

  try {
    const result = await invokeEmbedding(bound.providerId, bound.config, body);
    const info = getProvider(bound.providerId);
    return NextResponse.json(
      {
        vectors: result.vectors,
        dimensions: result.dimensions,
        model: result.model,
        tokens: result.tokens,
        provider: { id: bound.providerId, name: info?.name ?? bound.providerId },
      },
      { headers: { "X-Embedding-Provider": bound.providerId } },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: msg, providerId: bound.providerId }, { status: 502 });
  }
}
