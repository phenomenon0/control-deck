import { promises as fs } from "node:fs";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

import { s2sDir } from "@/lib/voice/s2s-url";

export const runtime = "nodejs";

/**
 * Local voice-clone reference clips for Qwen3-TTS.
 *
 * A "ref" is a short clean recording of the voice to clone plus its exact
 * transcript. We persist both under <s2s-repo>/data/voice-refs so the s2s
 * supervisor (which shares that repo) can read the absolute path we hand it
 * via --qwen3_tts_ref_audio. Each clip <slug>-<ts>.wav carries a sidecar
 * <slug>-<ts>.wav.json with { name, refText, createdAt } so the library grid
 * can restage the exact two knobs later.
 *
 *   POST  multipart { file, name, refText }  -> { path, name }
 *   GET                                       -> { refs: [...] }
 *   GET   ?path=<abs wav in voice-refs>       -> streams the raw clip
 */

const REF_LIMIT_BYTES = 25 * 1024 * 1024; // 25 MB — a 20s wav is well under this.

function refsDir(): string {
  return path.join(s2sDir(), "data", "voice-refs");
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "ref";
}

/** Resolve a requested wav path and prove it lives inside the refs dir. */
function safeRefPath(requested: string): string | null {
  const dir = path.resolve(refsDir());
  const resolved = path.resolve(requested);
  if (resolved !== dir && !resolved.startsWith(dir + path.sep)) return null;
  if (path.extname(resolved).toLowerCase() !== ".wav") return null;
  return resolved;
}

export async function GET(req: NextRequest) {
  const wanted = req.nextUrl.searchParams.get("path");

  // ── stream one clip (path-traversal guarded) ──────────────────────────────
  if (wanted) {
    const resolved = safeRefPath(wanted);
    if (!resolved) {
      return NextResponse.json({ error: "path must be a .wav inside the voice-refs dir" }, { status: 400 });
    }
    try {
      const bytes = await fs.readFile(resolved);
      return new NextResponse(new Uint8Array(bytes), {
        status: 200,
        headers: {
          "Content-Type": "audio/wav",
          "Content-Length": String(bytes.length),
          "Cache-Control": "no-store",
        },
      });
    } catch {
      return NextResponse.json({ error: "reference clip not found" }, { status: 404 });
    }
  }

  // ── list saved refs ────────────────────────────────────────────────────────
  const dir = refsDir();
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return NextResponse.json({ refs: [] }); // no dir yet == no refs, not an error
  }

  const wavs = entries.filter((f) => f.toLowerCase().endsWith(".wav"));
  const refs = await Promise.all(
    wavs.map(async (file) => {
      const abs = path.join(dir, file);
      const stat = await fs.stat(abs);
      let name = file.replace(/\.wav$/i, "");
      let refText = "";
      let createdAt = stat.birthtimeMs || stat.mtimeMs;
      try {
        const meta = JSON.parse(await fs.readFile(`${abs}.json`, "utf8")) as {
          name?: string;
          refText?: string;
          createdAt?: string;
        };
        if (typeof meta.name === "string" && meta.name.trim()) name = meta.name;
        if (typeof meta.refText === "string") refText = meta.refText;
        if (meta.createdAt) {
          const t = Date.parse(meta.createdAt);
          if (Number.isFinite(t)) createdAt = t;
        }
      } catch {
        /* sidecar optional — fall back to filename + file mtime */
      }
      return { name, path: abs, refText, size: stat.size, createdAt: new Date(createdAt).toISOString() };
    }),
  );

  refs.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return NextResponse.json({ refs });
}

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });
  }

  const file = form.get("file");
  const name = String(form.get("name") ?? "").trim();
  const refText = String(form.get("refText") ?? "").trim();

  if (!file || typeof (file as Blob).arrayBuffer !== "function") {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!refText) {
    return NextResponse.json({ error: "refText (exact transcript of the clip) is required" }, { status: 400 });
  }

  const bytes = Buffer.from(await (file as Blob).arrayBuffer());
  if (bytes.length === 0) {
    return NextResponse.json({ error: "reference clip is empty" }, { status: 400 });
  }
  if (bytes.length > REF_LIMIT_BYTES) {
    return NextResponse.json({ error: "reference clip exceeds 25 MB" }, { status: 413 });
  }

  const dir = refsDir();
  await fs.mkdir(dir, { recursive: true });

  const createdAt = new Date().toISOString();
  const base = `${slugify(name)}-${Date.now()}`;
  const abs = path.join(dir, `${base}.wav`);
  await fs.writeFile(abs, bytes);
  await fs.writeFile(`${abs}.json`, JSON.stringify({ name, refText, createdAt }, null, 2), "utf8");

  return NextResponse.json({ path: abs, name }, { status: 201 });
}
