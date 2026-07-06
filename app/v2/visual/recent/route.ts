/**
 * GET /v2/visual/recent — real gallery feed for the Visual surface.
 *
 * There is no listing endpoint for generated images: they live on disk as
 * data/artifacts/<runId>/<file>.png (served by /api/artifacts/[runId]/[filename]).
 * This route handler (kept inside the visual surface's own segment) scans the
 * artifact root, reads each PNG's real pixel dimensions from its IHDR header,
 * derives the model from the ComfyUI filename prefix, and returns the most
 * recent images newest-first. Read-only, no side effects.
 */

import { NextRequest, NextResponse } from "next/server";
import { open, readdir, stat } from "fs/promises";
import * as path from "path";
import { artifactRoot, artifactUrl } from "@/lib/storage/paths";

export const dynamic = "force-dynamic";

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);

export interface RecentImage {
  url: string;
  runId: string;
  name: string;
  model: string;
  width: number | null;
  height: number | null;
  seq: number | null;
  bytes: number;
  createdAt: string; // ISO — file mtime
}

/** Map the ComfyUI filename_prefix (see lib/tools/workflows) back to a model. */
function modelFor(name: string): string {
  const n = name.toLowerCase();
  if (n.startsWith("deck_turbo")) return "SDXL Turbo";
  if (n.startsWith("deck_lightning")) return "SDXL Lightning";
  if (n.startsWith("deck_flux_nunchaku")) return "FLUX Nunchaku";
  if (n.startsWith("deck_flux_gguf")) return "FLUX GGUF";
  if (n.startsWith("deck_flux")) return "FLUX";
  if (n.startsWith("deck_sdxl")) return "SDXL";
  if (n.startsWith("deck_img")) return "SDXL";
  if (n.startsWith("lite_ink")) return "Lite Ink";
  return "ComfyUI";
}

/** Read width/height from a PNG IHDR without loading the whole file. */
async function pngSize(filePath: string): Promise<{ width: number; height: number } | null> {
  let fh: Awaited<ReturnType<typeof open>> | null = null;
  try {
    fh = await open(filePath, "r");
    const buf = Buffer.alloc(33);
    const { bytesRead } = await fh.read(buf, 0, 33, 0);
    if (bytesRead < 33) return null;
    // PNG signature + IHDR chunk type
    if (buf.readUInt32BE(0) !== 0x89504e47) return null;
    if (buf.toString("latin1", 12, 16) !== "IHDR") return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  } catch {
    return null;
  } finally {
    await fh?.close();
  }
}

export async function GET(req: NextRequest) {
  const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get("limit")) || 60));
  const root = artifactRoot();

  let runDirs: string[];
  try {
    runDirs = await readdir(root);
  } catch {
    return NextResponse.json({ images: [], total: 0 });
  }

  const collected: (RecentImage & { mtimeMs: number })[] = [];

  await Promise.all(
    runDirs.map(async (runId) => {
      const dir = path.join(root, runId);
      let files: string[];
      try {
        const dstat = await stat(dir);
        if (!dstat.isDirectory()) return;
        files = await readdir(dir);
      } catch {
        return;
      }
      for (const name of files) {
        if (!IMAGE_EXT.has(path.extname(name).toLowerCase())) continue;
        const filePath = path.join(dir, name);
        try {
          const [st, dims] = await Promise.all([stat(filePath), pngSize(filePath)]);
          const seqMatch = name.match(/_(\d{3,})_/);
          collected.push({
            url: artifactUrl(runId, name),
            runId,
            name,
            model: modelFor(name),
            width: dims?.width ?? null,
            height: dims?.height ?? null,
            seq: seqMatch ? Number(seqMatch[1]) : null,
            bytes: st.size,
            createdAt: st.mtime.toISOString(),
            mtimeMs: st.mtimeMs,
          });
        } catch {
          /* skip unreadable file */
        }
      }
    }),
  );

  collected.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const images = collected.slice(0, limit).map(({ mtimeMs: _mtimeMs, ...rest }) => rest);

  return NextResponse.json({ images, total: collected.length });
}
