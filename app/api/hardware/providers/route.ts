/**
 * GET /api/hardware/providers — cross-provider hardware runner snapshot.
 *
 * Returns one entry per registered adapter with health + installed + loaded
 * model lists. Plus a discovery sweep of conventional ports + fs paths so
 * the UI can say "looks like you have LM Studio installed, want to enable
 * its adapter?".
 *
 * Each adapter is best-effort — one bad provider won't break the response.
 */

import { NextResponse } from "next/server";
import { snapshotAll } from "@/lib/hardware/providers/registry";
import { runDiscoverySweep } from "@/lib/hardware/providers/detected-probes";

export async function GET() {
  const [providers, discovered] = await Promise.all([
    snapshotAll(),
    runDiscoverySweep(),
  ]);
  return NextResponse.json({ providers, discovered });
}
