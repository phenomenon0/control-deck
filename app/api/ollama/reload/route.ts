/**
 * /api/ollama/reload — warm an Ollama model back into VRAM.
 *
 * The AUTO-SWAP flow unloads the chat LLM to make room for image gen. When the
 * user next chats, the v2 chat calls this to lazily reload the model BEFORE the
 * run starts. Mirrors the /api/ollama/ps POST unload trick with the opposite
 * sign: a zero-token /api/generate with a positive keep_alive warms the model
 * without producing output.
 */

import { NextResponse } from "next/server";

const OLLAMA_URL = process.env.OLLAMA_BASE_URL?.replace("/v1", "") ?? "http://localhost:11434";

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
      body: JSON.stringify({ model: body.name, prompt: "", keep_alive: "5m", stream: false }),
    });
    if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
