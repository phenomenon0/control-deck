/**
 * GET /api/catalog — browse the curated model catalogs.
 *
 * Returns entries from data/{nvidia,openrouter,hf}-catalog.json with
 * metadata the CLI uses (family, base_model, curated notes, modality,
 * context, pricing, stats). Useful for in-app catalog UIs that want the
 * full record, not the narrower FreeTierModel shape served by
 * /api/free-tier/status.
 *
 * Query params:
 *   provider  = nvidia | openrouter | hf         (default: all)
 *   modality  = text | vision | multimodal | … (filter)
 *   publisher = <exact match>
 *   family    = <exact match>
 *   tag       = <exact tag>
 *   free      = 1                               (only models tagged "free")
 *   q         = substring match on id/name/publisher/family/notes
 *   limit     = N                               (default 500)
 *
 * Response: { providers: [...], total, models: [...] }
 */

import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

type Provider = "nvidia" | "openrouter" | "hf";

interface CatalogModel {
  id: string;
  publisher: string;
  display_name: string;
  modality: string[];
  context_window: number | null;
  max_output: number | null;
  pricing: { prompt_per_mtok: number; completion_per_mtok: number } | null;
  rate_limits: { rpm: number | null; rpd: number | null } | null;
  tags: string[];
  family?: string | null;
  base_model?: string | null;
  notes: { cutoff: string | null; curated: string | null };
  stats: {
    p50_ms: number | null;
    p95_ms: number | null;
    calls_last_30d: number;
    last_measured: string | null;
    last_error: string | null;
  };
}
interface Catalog {
  provider: Provider;
  source: string;
  fetched_at: string;
  defaults: unknown;
  models: CatalogModel[];
}

function loadCatalog(p: Provider): Catalog | null {
  const file = path.join(process.cwd(), "data", `${p}-catalog.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Catalog;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.toLowerCase() ?? null;
  const modality = url.searchParams.get("modality");
  const publisher = url.searchParams.get("publisher");
  const family = url.searchParams.get("family");
  const tag = url.searchParams.get("tag");
  const freeOnly = url.searchParams.get("free") === "1";
  const providerParam = url.searchParams.get("provider") as Provider | null;
  const limit = Math.max(1, Math.min(5000, Number(url.searchParams.get("limit") ?? 500)));

  const providers: Provider[] = providerParam
    ? [providerParam]
    : ["nvidia", "openrouter", "hf"];

  const collected: Array<CatalogModel & { provider: Provider }> = [];
  const loadedProviders: Provider[] = [];
  for (const p of providers) {
    const cat = loadCatalog(p);
    if (!cat) continue;
    loadedProviders.push(p);
    for (const m of cat.models) {
      if (modality && !m.modality.includes(modality)) continue;
      if (publisher && m.publisher !== publisher) continue;
      if (family && (m.family ?? "") !== family) continue;
      if (tag && !m.tags.includes(tag)) continue;
      if (freeOnly && !m.tags.includes("free")) continue;
      if (q) {
        const hay = [
          m.id,
          m.display_name,
          m.publisher,
          m.family ?? "",
          m.notes.curated ?? "",
          m.modality.join(" "),
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) continue;
      }
      collected.push({ provider: p, ...m });
      if (collected.length >= limit) break;
    }
    if (collected.length >= limit) break;
  }

  return NextResponse.json({
    providers: loadedProviders,
    total: collected.length,
    models: collected,
  });
}
