/**
 * Artifacts API - Serve generated artifacts (images, audio, etc.)
 */

import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs/promises";
import * as path from "path";

const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || path.join(process.cwd(), "data", "artifacts");

// MIME type mapping
const MIME_TYPES: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string; filename: string }> }
) {
  const { runId, filename } = await params;

  // Prevent path traversal: resolve the candidate path and assert it still
  // lives under ARTIFACTS_DIR. Catches `..`, encoded variants Next already
  // decoded, absolute paths, and symlink-style tricks in a single check.
  const artifactsRoot = path.resolve(ARTIFACTS_DIR);
  const filePath = path.resolve(artifactsRoot, runId, filename);
  if (
    filePath !== artifactsRoot &&
    !filePath.startsWith(artifactsRoot + path.sep)
  ) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  try {
    // Check if file exists
    await fs.access(filePath);

    // Read file
    const data = await fs.readFile(filePath);

    // Determine MIME type
    const ext = path.extname(filename).toLowerCase();
    const mimeType = MIME_TYPES[ext] || "application/octet-stream";

    // Return file
    return new NextResponse(data, {
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Disposition": `inline; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error(`[Artifacts] File not found: ${filePath}`, error);
    return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  }
}
