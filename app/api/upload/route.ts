/**
 * Upload API - Handle image/file uploads
 * Stores files as base64 in SQLite (max 20MB)
 */

import { NextRequest, NextResponse } from "next/server";
import { createUpload, getUpload, getUploadsByThread } from "@/lib/agui/db";
import { generateId } from "@/lib/agui/events";
import { safeDispositionFilename } from "@/lib/upload/utils";

const ALLOWED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "audio/wav",
  "audio/mp3",
  "audio/mpeg",
];

const MAX_SIZE = 20 * 1024 * 1024; // 20MB

/**
 * POST /api/upload - Upload a file
 * Body: { threadId: string, data: string (base64), mimeType: string, filename?: string }
 * Or: FormData with file and threadId
 */
export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") ?? "";
    
    let threadId: string;
    let data: string;
    let mimeType: string;
    let filename: string | undefined;

    if (contentType.includes("multipart/form-data")) {
      // Handle FormData upload
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      threadId = formData.get("threadId") as string;
      
      if (!file) {
        return NextResponse.json({ error: "No file provided" }, { status: 400 });
      }
      
      if (!threadId) {
        return NextResponse.json({ error: "threadId is required" }, { status: 400 });
      }
      
      mimeType = file.type;
      filename = safeDispositionFilename(file.name);
      
      // Convert to base64
      const arrayBuffer = await file.arrayBuffer();
      data = Buffer.from(arrayBuffer).toString("base64");
    } else {
      // Handle JSON upload (base64 already encoded)
      const body = await req.json();
      threadId = body.threadId;
      data = body.data;
      mimeType = body.mimeType;
      filename = body.filename != null ? safeDispositionFilename(body.filename) : undefined;
      
      if (!threadId || !data || !mimeType) {
        return NextResponse.json(
          { error: "threadId, data, and mimeType are required" },
          { status: 400 }
        );
      }
    }

    // Validate mime type
    if (!ALLOWED_TYPES.includes(mimeType)) {
      return NextResponse.json(
        { error: `Unsupported file type: ${mimeType}. Allowed: ${ALLOWED_TYPES.join(", ")}` },
        { status: 400 }
      );
    }

    // Check size
    const size = Buffer.byteLength(data, "base64");
    if (size > MAX_SIZE) {
      return NextResponse.json(
        { error: `File too large: ${(size / 1024 / 1024).toFixed(1)}MB (max 20MB)` },
        { status: 400 }
      );
    }

    // Generate ID and save
    const id = generateId();
    createUpload(id, threadId, data, mimeType, filename);

    return NextResponse.json({
      id,
      threadId,
      mimeType,
      filename,
      size,
      url: `/api/upload/${id}`,
    });
  } catch (error) {
    console.error("Upload error:", error);
    const msg = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * GET /api/upload?threadId=xxx - List uploads for a thread
 */
export async function GET(req: NextRequest) {
  const threadId = req.nextUrl.searchParams.get("threadId");
  
  if (!threadId) {
    return NextResponse.json({ error: "threadId is required" }, { status: 400 });
  }

  const uploads = getUploadsByThread(threadId);
  
  return NextResponse.json({
    uploads: uploads.map((u) => ({
      id: u.id,
      mimeType: u.mime_type,
      filename: u.filename,
      size: u.size,
      createdAt: u.created_at,
      url: `/api/upload/${u.id}`,
    })),
  });
}
