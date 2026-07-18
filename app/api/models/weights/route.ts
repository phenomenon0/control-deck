/**
 * /api/models/weights — the installer's API (release-QA decisions B1/B3).
 *
 * GET    → catalog with per-file on-disk state, running download jobs, and
 *          per-preset rollups (missing files, total download size, VRAM fit
 *          verdict from the live ledger).
 * POST   → { preset } or { files: [keys] } enqueues downloads.
 * DELETE → ?job=<id> cancels a job (queued or running; .part kept for resume).
 */

import { NextResponse, type NextRequest } from "next/server";
import * as fs from "node:fs/promises";
import { z } from "zod";
import {
  PRESET_WEIGHTS,
  WEIGHT_FILES,
  presetVramBytes,
  weightAbsolutePath,
} from "@/lib/models/weights-catalog";
import { enqueueDownloads, listJobs, cancelJob } from "@/lib/models/downloader";
import { canFit, estimateVramMb } from "@/lib/hardware/vram";
import { refreshSnapshot } from "@/lib/resource/ledger";
import { denyIfCrossOrigin } from "@/lib/security/originGuard";

export const runtime = "nodejs";

export async function GET() {
  const files = await Promise.all(
    WEIGHT_FILES.map(async (f) => {
      const abs = weightAbsolutePath(f);
      const st = await fs.stat(abs).catch(() => null);
      const part = await fs.stat(`${abs}.part`).catch(() => null);
      const isFile = st?.isFile() ?? false;
      const expectedBytes = f.url ? (f.approxBytes ?? null) : null;
      const corrupt = isFile && expectedBytes != null && st!.size !== expectedBytes;
      return {
        key: f.key,
        filename: f.filename,
        kind: f.kind,
        approxBytes: f.approxBytes ?? null,
        hasSource: !!f.url,
        notes: f.notes,
        onDisk: isFile && !corrupt,
        corrupt,
        bytesOnDisk: st?.size ?? null,
        partialBytes: part?.size ?? null,
      };
    }),
  );
  const byKey = new Map(files.map((f) => [f.key, f]));

  // B3: fit verdicts against the live ledger (best-effort — no GPU → unknown).
  let freeMb: number | null = null;
  let totalMb: number | null = null;
  try {
    const snap = await refreshSnapshot();
    freeMb = snap.freeMb;
    totalMb = snap.totalMb;
  } catch {
    /* ledger unavailable */
  }

  const presets = Object.fromEntries(
    Object.entries(PRESET_WEIGHTS).map(([preset, keys]) => {
      const entries = keys.map((k) => byKey.get(k)!).filter(Boolean);
      const missing = entries.filter((e) => !e.onDisk);
      const downloadBytes = missing.reduce((a, e) => a + (e.approxBytes ?? 0), 0);
      const estimateMb = estimateVramMb(presetVramBytes(preset));
      const fit =
        freeMb != null && totalMb != null
          ? canFit(estimateMb, {
              name: "gpu0",
              memoryTotal: totalMb,
              memoryUsed: totalMb - freeMb,
              memoryPercent: totalMb > 0 ? Math.round(((totalMb - freeMb) / totalMb) * 100) : 0,
              utilization: 0,
              temperature: 0,
            }).verdict
          : "unknown";
      return [
        preset,
        {
          files: keys,
          complete: missing.length === 0,
          missing: missing.map((e) => e.key),
          unsourced: missing.filter((e) => !e.hasSource).map((e) => e.key),
          downloadBytes,
          vramEstimateMb: estimateMb,
          fit,
        },
      ];
    }),
  );

  return NextResponse.json({ files, presets, jobs: listJobs(), gpu: { freeMb, totalMb } });
}

const DownloadRequestSchema = z.object({
  preset: z.string().trim().min(1).optional(),
  files: z.array(z.string().trim().min(1)).min(1).max(WEIGHT_FILES.length).optional(),
}).strict().refine(
  (value) => Number(value.preset !== undefined) + Number(value.files !== undefined) === 1,
  { message: "provide exactly one of preset or files" },
);

export async function POST(req: NextRequest) {
  const denied = denyIfCrossOrigin(req);
  if (denied) return denied;

  let input: unknown;
  try {
    input = await req.json();
  } catch {
    return NextResponse.json({ error: "body must be { preset } or { files: [] }" }, { status: 400 });
  }
  const parsed = DownloadRequestSchema.safeParse(input);
  if (!parsed.success) {
    return NextResponse.json({ error: "body must contain exactly one valid preset or bounded file list" }, { status: 400 });
  }

  const knownKeys = new Set(WEIGHT_FILES.map((file) => file.key));
  let keys: string[];
  if (parsed.data.preset !== undefined) {
    const presetKeys = PRESET_WEIGHTS[parsed.data.preset];
    if (!presetKeys) {
      return NextResponse.json({ error: "unknown preset" }, { status: 400 });
    }
    keys = presetKeys;
  } else {
    keys = Array.from(new Set(parsed.data.files!));
    if (keys.some((key) => !knownKeys.has(key))) {
      return NextResponse.json({ error: "file list contains an unknown catalog key" }, { status: 400 });
    }
  }
  const result = await enqueueDownloads(keys);
  return NextResponse.json(result);
}

export async function DELETE(req: NextRequest) {
  const denied = denyIfCrossOrigin(req);
  if (denied) return denied;
  const id = req.nextUrl.searchParams.get("job");
  if (!id) return NextResponse.json({ error: "?job=<id> required" }, { status: 400 });
  const ok = cancelJob(id);
  return NextResponse.json({ cancelled: ok });
}
