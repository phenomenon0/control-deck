/**
 * GET /api/llamacpp/status — health probe for llama-server.
 *
 * Returns { online, url, latencyMs?, modelId? } so the deck shell can
 * tell whether the local LLM is ready before showing the chat surface.
 */

import { NextResponse } from "next/server";
import { probeLlamacpp } from "@/lib/llamacpp/launcher";

export async function GET() {
  const result = await probeLlamacpp();
  return NextResponse.json(result);
}
