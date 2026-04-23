/**
 * GET /api/hardware/gpu-processes — per-process GPU activity.
 *
 * Response shape: `{ processes, supported, kind }` where `kind` is:
 *   - "vram"       NVIDIA nvidia-smi, real per-process VRAM
 *   - "rss-proxy"  macOS, RSS of GPU-intensive processes (unified memory)
 *   - "none"       nothing returned, non-NVIDIA / non-Mac platform
 */

import { NextResponse } from "next/server";
import { collectGpuProcesses } from "@/lib/hardware/gpu-processes";

export async function GET() {
  const processes = await collectGpuProcesses();
  if (processes === null) {
    return NextResponse.json({ processes: [], supported: false, kind: "none" });
  }
  const kind = process.platform === "darwin" ? "rss-proxy" : "vram";
  return NextResponse.json({ processes, supported: true, kind });
}
