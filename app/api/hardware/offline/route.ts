/**
 * GET /api/hardware/offline — disk-side model inventory.
 *
 * Walks the well-known locations for Ollama manifests, GGUF files, HF Hub
 * cache and LM Studio cache. Works whether or not any provider server is
 * running — that's the whole point.
 *
 * Capped at 200 entries per source so a pathological cache doesn't
 * balloon the response.
 */

import { NextResponse } from "next/server";
import { scanOffline } from "@/lib/hardware/offline-scanner";

export async function GET() {
  const result = scanOffline();
  return NextResponse.json(result);
}
