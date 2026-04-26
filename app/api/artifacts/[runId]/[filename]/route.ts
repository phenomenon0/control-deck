/**
 * Artifacts API - Serve generated artifacts (images, audio, etc.)
 */

import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs/promises";
import * as path from "path";
import { resolveArtifactRequestPath, safeArtifactFilename } from "@/lib/storage/paths";

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
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string; filename: string }> }
) {
  const { runId, filename } = await params;

  const filePath = resolveArtifactRequestPath(runId, filename);
  if (!filePath) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  try {
    // Check if file exists
    await fs.access(filePath);

    // Read file
    const data = await fs.readFile(filePath);

    // Determine MIME type
    const displayName = safeArtifactFilename(filename);
    const ext = path.extname(displayName).toLowerCase();
    const mimeType = MIME_TYPES[ext] || "application/octet-stream";

    // Return file
    return new NextResponse(data, {
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Disposition": `inline; filename="${displayName}"`,
      },
    });
  } catch (error) {
    console.error(`[Artifacts] File not found: ${filePath}`, error);
    return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  }
}
