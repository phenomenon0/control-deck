/**
 * /api/ollama/ps — currently-resident Ollama models.
 *
 * Bridges Ollama's own `/api/ps` (loaded sessions) so the Hardware pane can
 * show what's hot in VRAM right now. Also exposes POST to unload a model
 * by setting `keep_alive: 0` on a zero-token generation — the canonical
 * Ollama trick, since there's no dedicated unload endpoint.
 */

import { NextResponse } from "next/server";

const OLLAMA_URL = process.env.OLLAMA_BASE_URL?.replace("/v1", "") ?? "http://localhost:11434";

export interface LoadedOllamaModel {
  name: string;
  model: string;
  size: number;
  size_vram: number;
  digest: string;
  expires_at: string;
  details: {
    parent_model?: string;
    format: string;
    family: string;
    families?: string[];
    parameter_size: string;
    quantization_level: string;
  };
}

export async function GET() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/ps`, { cache: "no-store" });
    if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
    const data = (await res.json()) as { models: LoadedOllamaModel[] };
    return NextResponse.json({ models: data.models ?? [] });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: msg, models: [] }, { status: 502 });
  }
}

/**
 * POST { name } → unload that model by issuing a no-op generate with
 * keep_alive: 0, which tells Ollama to evict it from VRAM immediately.
 */
export async function POST(req: Request) {
  let body: { name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!body.name) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: body.name, prompt: "", keep_alive: 0, stream: false }),
    });
    if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
