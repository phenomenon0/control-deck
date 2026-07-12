/**
 * GET /api/voice/model-cache?models=org/name,org2/name2
 * (release-QA decision B4 — read-only availability probe for voice models.)
 *
 * The s2s stack downloads its STT/TTS weights itself via HF_HOME; the deck
 * has no business managing that, but it CAN say whether a pipeline restart
 * will start instantly (cached) or sit through a multi-GB download first.
 * A model counts as cached when its hub dir exists and holds at least one
 * snapshot with real (non-.incomplete) files.
 */

import { NextResponse, type NextRequest } from "next/server";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export const runtime = "nodejs";

function hubDir(): string {
  const home = process.env.HF_HOME ?? path.join(os.homedir(), ".cache", "huggingface");
  return path.join(home, "hub");
}

async function isCached(modelId: string): Promise<{ cached: boolean; bytes: number }> {
  const dirName = `models--${modelId.replaceAll("/", "--")}`;
  const snapshots = path.join(hubDir(), dirName, "snapshots");
  try {
    const snaps = await fs.readdir(snapshots);
    for (const snap of snaps) {
      const files = await fs.readdir(path.join(snapshots, snap)).catch(() => []);
      if (files.some((f) => !f.endsWith(".incomplete"))) {
        // Size from blobs (snapshot entries are symlinks into blobs/)
        const blobs = path.join(hubDir(), dirName, "blobs");
        let bytes = 0;
        for (const b of await fs.readdir(blobs).catch(() => [])) {
          const st = await fs.stat(path.join(blobs, b)).catch(() => null);
          if (st?.isFile()) bytes += st.size;
        }
        return { cached: true, bytes };
      }
    }
  } catch {
    /* not cached */
  }
  return { cached: false, bytes: 0 };
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("models") ?? "";
  const ids = raw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 32);
  if (ids.length === 0) {
    return NextResponse.json({ error: "?models=org/name[,org/name] required" }, { status: 400 });
  }
  const entries = await Promise.all(ids.map(async (id) => [id, await isCached(id)] as const));
  return NextResponse.json({ models: Object.fromEntries(entries), hubDir: hubDir() });
}
