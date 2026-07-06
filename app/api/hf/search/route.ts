/**
 * /api/hf/search — server-side Hugging Face model discovery.
 *
 * GET ?q=<query> → proxies https://huggingface.co/api/models, preferring GGUF
 * repos (pull-able via `ollama pull hf.co/<org>/<repo>`) and falling back to a
 * wider text-generation search when the GGUF filter returns nothing. Runs on
 * the server so it dodges CORS and works inside Electron. Any upstream error
 * degrades to an empty list — the Library search must never crash on it.
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface HfModelRaw {
  id?: string;
  modelId?: string;
  downloads?: number;
  likes?: number;
  tags?: string[];
  gated?: boolean | string;
  pipeline_tag?: string;
}
interface HfModelTrim {
  id: string;
  downloads: number;
  likes: number;
  tags: string[];
  gated: boolean;
  pipeline_tag: string | null;
}

async function hfFetch(url: string): Promise<HfModelRaw[] | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "control-deck/0.1" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as unknown;
    return Array.isArray(data) ? (data as HfModelRaw[]) : null;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (!q) return NextResponse.json({ models: [] });

  const enc = encodeURIComponent(q);
  // 1) GGUF repos (directly pull-able through Ollama); 2) widen the net.
  const urls = [
    `https://huggingface.co/api/models?search=${enc}&filter=gguf&sort=downloads&direction=-1&limit=25`,
    `https://huggingface.co/api/models?search=${enc}&filter=text-generation&sort=downloads&direction=-1&limit=25`,
    `https://huggingface.co/api/models?search=${enc}&sort=downloads&direction=-1&limit=25`,
  ];

  let raw: HfModelRaw[] | null = null;
  for (const u of urls) {
    raw = await hfFetch(u);
    if (raw && raw.length) break;
  }
  if (!raw) return NextResponse.json({ models: [] });

  const models: HfModelTrim[] = raw
    .map((m): HfModelTrim => {
      const id = m.id ?? m.modelId ?? "";
      return {
        id,
        downloads: typeof m.downloads === "number" ? m.downloads : 0,
        likes: typeof m.likes === "number" ? m.likes : 0,
        tags: Array.isArray(m.tags) ? m.tags.slice(0, 12) : [],
        gated: Boolean(m.gated && m.gated !== "false"),
        pipeline_tag: m.pipeline_tag ?? null,
      };
    })
    .filter((m) => m.id);

  return NextResponse.json({ models });
}
