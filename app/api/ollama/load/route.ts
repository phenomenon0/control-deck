/**
 * POST /api/ollama/load { model } — admission-controlled model load
 * (release-QA decision C2).
 *
 * Replaces the models page's client-direct `POST :11434/api/generate`,
 * which raced every other GPU tenant. Flow: estimate from the tag's file
 * size → arbiter acquire on the chat lane (hard-evict idle tenants per
 * policy) → dispatch the keep_alive load → confirm via /api/ps (measure,
 * don't estimate) and correct the reservation to the real size_vram.
 */

import { NextResponse } from "next/server";
import { acquire, release } from "@/lib/resource/arbiter";
import { estimateVramMb } from "@/lib/hardware/vram";

export const runtime = "nodejs";

const OLLAMA_URL = (process.env.OLLAMA_BASE_URL ?? process.env.OLLAMA_URL ?? "http://localhost:11434").replace("/v1", "");

interface TagModel {
  name?: string;
  size?: number;
}

export async function POST(req: Request) {
  let model: string;
  try {
    const body = (await req.json()) as { model?: string };
    if (!body.model || typeof body.model !== "string") throw new Error("missing model");
    model = body.model;
  } catch {
    return NextResponse.json({ error: "body must be { model: string }" }, { status: 400 });
  }

  // Size the request from the installed tag; unknown tags still load but
  // reserve a conservative default so the arbiter isn't blind.
  let estimateMb = 8_192;
  try {
    const tags = await fetch(`${OLLAMA_URL}/api/tags`, { cache: "no-store", signal: AbortSignal.timeout(3_000) });
    if (tags.ok) {
      const data = (await tags.json()) as { models?: TagModel[] };
      const tag = (data.models ?? []).find((m) => m.name === model);
      if (tag?.size) estimateMb = estimateVramMb(tag.size);
    }
  } catch {
    /* tags unreachable — the generate call below will fail loudly anyway */
  }

  const acq = await acquire({
    lane: "chat",
    estimateMb,
    reason: `ollama load: ${model}`,
    modelId: model,
    priority: "interactive",
    evicts: "hard",
    restoreOnIdle: true,
  });
  if (acq.status !== "granted" || !acq.ticket) {
    return NextResponse.json(
      { error: `not enough VRAM for ${model}: ${acq.reason ?? acq.status}` },
      { status: 503 },
    );
  }

  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: "", keep_alive: "5m", stream: false }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      release(acq.ticket);
      return NextResponse.json({ error: `ollama returned ${res.status}` }, { status: 502 });
    }

    // Measure, don't estimate: read the real footprint back from /api/ps.
    let measuredVramMb: number | undefined;
    try {
      const ps = await fetch(`${OLLAMA_URL}/api/ps`, { cache: "no-store", signal: AbortSignal.timeout(3_000) });
      if (ps.ok) {
        const data = (await ps.json()) as { models?: Array<{ name?: string; size_vram?: number }> };
        const row = (data.models ?? []).find((m) => m.name === model);
        if (row?.size_vram) measuredVramMb = Math.round(row.size_vram / (1024 * 1024));
      }
    } catch {
      /* ps probe is best-effort */
    }

    return NextResponse.json({
      loaded: true,
      model,
      estimateMb,
      measuredVramMb,
      ticket: acq.ticket,
    });
  } catch (e) {
    release(acq.ticket);
    const msg = e instanceof Error ? e.message : "load failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
