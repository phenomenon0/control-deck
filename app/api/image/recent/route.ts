/**
 * GET /api/image/recent - gallery feed for generated image artifacts.
 *
 * Generated images live on disk as data/artifacts/<runId>/<file> and are served
 * by /api/artifacts/[runId]/[filename]. This route scans the artifact root,
 * reads PNG dimensions from IHDR headers, infers model/kind from ComfyUI
 * filename prefixes, and returns the newest images first.
 */

import { NextRequest, NextResponse } from "next/server";
import { open, readdir, stat } from "fs/promises";
import * as path from "path";
import { artifactRoot, artifactUrl } from "@/lib/storage/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 500;

type ImageKind = "generate" | "edit" | "upscale" | "unknown";

interface RecentImage {
  url: string;
  name: string;
  width: number | null;
  height: number | null;
  mtime: number;
  model: string;
  kind: ImageKind;
}

const MODEL_PREFIXES: Array<{ prefix: string; model: string; kind: Exclude<ImageKind, "unknown"> }> = [
  { prefix: "deck_qwen_edit", model: "Qwen Image Edit", kind: "edit" },
  { prefix: "deck_zimage", model: "Z-Image Turbo", kind: "generate" },
  { prefix: "deck_upscale", model: "Upscaled", kind: "upscale" },
  { prefix: "deck_turbo", model: "SDXL Turbo", kind: "generate" },
  { prefix: "deck_lightning", model: "SDXL Lightning", kind: "generate" },
  { prefix: "deck_flux_nunchaku", model: "FLUX Nunchaku", kind: "generate" },
  { prefix: "deck_flux_gguf", model: "FLUX GGUF", kind: "generate" },
  { prefix: "deck_flux2", model: "FLUX.2 klein", kind: "generate" },
  { prefix: "deck_flux", model: "FLUX", kind: "generate" },
  { prefix: "deck_sdxl", model: "SDXL", kind: "generate" },
  { prefix: "deck_img", model: "SDXL", kind: "generate" },
  { prefix: "lite_ink", model: "Lite Ink", kind: "generate" },
];

function parseLimit(value: string | null): number {
  if (!value) return DEFAULT_LIMIT;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(parsed)));
}

/** Map the ComfyUI filename_prefix (see lib/tools/workflows) back to a model. */
function modelInfoFor(name: string): { model: string; kind: ImageKind } {
  const n = name.toLowerCase();
  const match = MODEL_PREFIXES.find(({ prefix }) => n.startsWith(prefix));
  if (match) return { model: match.model, kind: match.kind };
  return { model: "Unknown", kind: "unknown" };
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
  const limit = parseLimit(req.nextUrl.searchParams.get("limit"));
  const root = artifactRoot();

  let runDirs: string[];
  try {
    runDirs = await readdir(root);
  } catch {
    return NextResponse.json({ images: [], total: 0 });
  }

  const collected: RecentImage[] = [];

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
          if (!st.isFile()) continue;
          const { model, kind } = modelInfoFor(name);
          collected.push({
            url: artifactUrl(runId, name),
            name,
            width: dims?.width ?? null,
            height: dims?.height ?? null,
            mtime: st.mtimeMs,
            model,
            kind,
          });
        } catch {
          /* skip unreadable file */
        }
      }
    }),
  );

  collected.sort((a, b) => b.mtime - a.mtime);

  return NextResponse.json({ images: collected.slice(0, limit), total: collected.length });
}
