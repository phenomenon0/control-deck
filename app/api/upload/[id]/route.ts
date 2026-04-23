/**
 * Upload View API - Serve uploaded files
 * GET /api/upload/[id] - Returns the file data
 */

import { NextRequest, NextResponse } from "next/server";
import { getUpload } from "@/lib/agui/db";
import { safeDispositionFilename } from "@/lib/upload/utils";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  
  const upload = getUpload(id);
  
  if (!upload) {
    return NextResponse.json({ error: "Upload not found" }, { status: 404 });
  }

  // Decode base64 to buffer
  const buffer = Buffer.from(upload.data, "base64");

  return new Response(buffer, {
    headers: {
      "Content-Type": upload.mime_type,
      "Content-Length": String(buffer.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      ...(upload.filename && {
        "Content-Disposition": `inline; filename="${safeDispositionFilename(upload.filename)}"`,
      }),
    },
  });
}
