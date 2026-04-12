/**
 * Local GGUF Model Registry API
 * Manages local GGUF model files for llama-server and other backends
 * 
 * GET  /api/models - List local GGUF models
 * POST /api/models - Download a GGUF model from URL (usually Hugging Face)
 * DELETE /api/models - Delete a local GGUF model
 */

import { NextResponse } from "next/server";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";

// Default models directory - can be overridden via MODELS_DIR env var
const MODELS_DIR = process.env.MODELS_DIR ?? path.join(process.env.HOME ?? "/home", ".local/share/models");

export interface LocalModel {
  name: string;
  filename: string;
  path: string;
  size: number;
  sizeHuman: string;
  modified: string;
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

/**
 * GET /api/models - List local GGUF models
 */
export async function GET() {
  // Ensure directory exists
  try {
    await fsp.access(MODELS_DIR);
  } catch (err: unknown) {
    const code = err && typeof err === "object" && "code" in err ? (err as { code: string }).code : null;
    if (code !== "ENOENT") {
      console.error("[models] Cannot access models directory:", err);
      return NextResponse.json({ error: "Cannot access models directory" }, { status: 500 });
    }
    // Directory doesn't exist - create it and return empty list
    await fsp.mkdir(MODELS_DIR, { recursive: true });
    return NextResponse.json({ models: [], modelsDir: MODELS_DIR });
  }

  try {
    const entries = await fsp.readdir(MODELS_DIR, { withFileTypes: true });
    const models: LocalModel[] = [];

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".gguf")) {
        const filePath = path.join(MODELS_DIR, entry.name);
        const stats = await fsp.stat(filePath);
        models.push({
          name: entry.name.replace(".gguf", ""),
          filename: entry.name,
          path: filePath,
          size: stats.size,
          sizeHuman: formatBytes(stats.size),
          modified: stats.mtime.toISOString(),
        });
      }
    }

    // Sort by name
    models.sort((a, b) => a.name.localeCompare(b.name));
    
    return NextResponse.json({ models, modelsDir: MODELS_DIR });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: msg, models: [] }, { status: 500 });
  }
}

/**
 * POST /api/models - Download a GGUF model from URL
 * Body: { url: string, name?: string }
 * 
 * Supports Hugging Face URLs like:
 * - https://huggingface.co/TheBloke/Llama-2-7B-GGUF/resolve/main/llama-2-7b.Q4_K_M.gguf
 */
export async function POST(req: Request) {
  let body: { url?: string; name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { url, name } = body;

  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  // Validate URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  // Derive filename from URL or use provided name
  const urlFilename = path.basename(parsedUrl.pathname);
  const fileName = name 
    ? (name.endsWith(".gguf") ? name : `${name}.gguf`)
    : urlFilename;
    
  if (!fileName.endsWith(".gguf")) {
    return NextResponse.json({ error: "URL must point to a .gguf file" }, { status: 400 });
  }

  // Security: prevent path traversal
  const safeName = path.basename(fileName);
  const destPath = path.join(MODELS_DIR, safeName);

  // Check if file already exists
  try {
    await fsp.access(destPath);
    return NextResponse.json({ error: `Model ${safeName} already exists` }, { status: 409 });
  } catch (err: unknown) {
    const code = err && typeof err === "object" && "code" in err ? (err as { code: string }).code : null;
    if (code !== "ENOENT") {
      console.error("[models] Cannot check destination path:", err);
      return NextResponse.json({ error: "Cannot access download path" }, { status: 500 });
    }
    // File doesn't exist - good, proceed with download
  }

  // Ensure directory exists
  await fsp.mkdir(MODELS_DIR, { recursive: true });

  try {
    console.log(`[Models] Downloading ${url} to ${destPath}`);
    
    const response = await fetch(url, {
      headers: {
        // Some servers need a User-Agent
        "User-Agent": "control-deck/1.0",
      },
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
    }

    const contentLength = parseInt(response.headers.get("content-length") ?? "0", 10);
    console.log(`[Models] Content-Length: ${formatBytes(contentLength)}`);

    // Stream to file
    const fileStream = fs.createWriteStream(destPath);
    const reader = response.body?.getReader();
    
    if (!reader) {
      throw new Error("No response body");
    }

    let downloaded = 0;
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        fileStream.write(value);
        downloaded += value.length;
        
        // Log progress every 100MB
        if (downloaded % (100 * 1024 * 1024) < value.length) {
          const pct = contentLength > 0 ? Math.round((downloaded / contentLength) * 100) : "?";
          console.log(`[Models] Progress: ${formatBytes(downloaded)} / ${formatBytes(contentLength)} (${pct}%)`);
        }
      }
    } finally {
      fileStream.close();
    }

    console.log(`[Models] Download complete: ${formatBytes(downloaded)}`);

    return NextResponse.json({
      ok: true,
      name: safeName.replace(".gguf", ""),
      filename: safeName,
      path: destPath,
      size: downloaded,
      sizeHuman: formatBytes(downloaded),
    });
  } catch (error) {
    // Clean up partial download
    try { 
      await fsp.unlink(destPath); 
    } catch {
      // Ignore cleanup errors
    }
    
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error(`[Models] Download failed:`, msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * DELETE /api/models - Delete a local GGUF model
 * Body: { name: string }
 */
export async function DELETE(req: Request) {
  let body: { name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { name } = body;

  if (!name || typeof name !== "string") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  // Security: prevent path traversal
  const safeName = path.basename(name);
  const fileName = safeName.endsWith(".gguf") ? safeName : `${safeName}.gguf`;
  const filePath = path.join(MODELS_DIR, fileName);

  try {
    await fsp.unlink(filePath);
    console.log(`[Models] Deleted: ${filePath}`);
    return NextResponse.json({ ok: true, deleted: fileName });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ error: `Model ${fileName} not found` }, { status: 404 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
