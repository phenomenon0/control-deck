#!/usr/bin/env tsx
/**
 * Model catalog CLI.
 *
 * Single source of truth for provider model catalogs. Each provider's
 * catalog lives in data/<provider>-catalog.json and carries enough
 * metadata (modality, context window, tags, curated notes, cutoff,
 * family grouping, base-model lineage, and measured latency) that the
 * UI, the router, and a human with `jq` can all read the same file.
 *
 * Usage:
 *   tsx scripts/model-catalog.ts <subcommand> [flags]
 *
 * Read-only subcommands (offline):
 *   list            [--provider X] [--modality M] [--publisher P] [--tag T] [--json]
 *   search          <query> [--provider X]
 *   show            <model-id>
 *   stats           [--provider X] [--days 30]              (reads data/deck.db)
 *   families        [--provider X] [--json]                 (group counts by family)
 *   constellation   [--provider X] [--family F] [--tree | --table | --json]
 *
 * Mutating subcommands (write to data/*.json):
 *   refresh         --provider nvidia|openrouter|hf [--dry] [--yes]   (network)
 *   probe           <model-id> [--provider X] [--prompt "..."]        (network)
 *   merge           --provider X --file patch.json [--dry]
 *   classify        [--provider X] [--dry]
 *
 * Schema (see CatalogModel below):
 *   id / publisher / display_name / modality[] / context_window / max_output
 *   pricing { prompt_per_mtok, completion_per_mtok } | null
 *   rate_limits { rpm, rpd } | null
 *   tags[]
 *   family?          — grouping key, e.g. "llama-3", "qwen-3" (classify)
 *   base_model?      — foundation id if fine-tuned (drives constellation edges)
 *   notes            { cutoff, curated }    — curated = 1-4 sentences
 *   stats            { p50_ms, p95_ms, calls_last_30d, last_measured, last_error }
 *
 * The JSON files are stored one-model-per-line to keep diffs tractable;
 * lib/llm/freeTier.ts reads them at runtime and the /api/catalog route
 * serves them to the UI.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- types ----------------------------------------------------------------

type Provider = "nvidia" | "openrouter" | "hf";

type Modality =
  | "text"
  | "vision"
  | "multimodal"
  | "embedding"
  | "reranker"
  | "image_gen"
  | "video_gen"
  | "3d_gen"
  | "speech"
  | "safety"
  | "ocr"
  | "object_detection"
  | "bio"
  | "climate"
  | "optimization"
  | "other";

interface CatalogModel {
  id: string;
  publisher: string;
  display_name: string;
  modality: Modality[];
  context_window: number | null;
  max_output: number | null;
  pricing: { prompt_per_mtok: number; completion_per_mtok: number } | null;
  rate_limits: { rpm: number | null; rpd: number | null } | null;
  tags: string[];
  // `family` is the curated grouping key (e.g. "llama-3", "qwen-3",
  // "deepseek-v3", "gemma-3"); nullable for unclassified stubs. `base_model`
  // is the foundation id this one was fine-tuned from, if any — drives the
  // constellation edges.
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
  defaults: {
    api_base: string;
    rate_limits: { rpm: number | null; rpd: number | null } | null;
    pricing: { prompt_per_mtok: number; completion_per_mtok: number } | null;
    auth: "bearer" | "none";
    env_key: string;
  };
  models: CatalogModel[];
}

// ---- paths ----------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(REPO_ROOT, "data");

function catalogPath(p: Provider): string {
  return path.join(DATA_DIR, `${p}-catalog.json`);
}

function resolveDbPath(): string {
  if (process.env.DECK_DB_PATH) return process.env.DECK_DB_PATH;
  const local = path.join(REPO_ROOT, "data", "deck.db");
  if (fs.existsSync(local)) return local;
  const xdgState = process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state");
  return path.join(xdgState, "control-deck", "data", "deck.db");
}

// ---- io -------------------------------------------------------------------

function loadCatalog(p: Provider): Catalog {
  const file = catalogPath(p);
  if (!fs.existsSync(file)) {
    throw new Error(`no catalog at ${file} — run: refresh --provider ${p}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as Catalog;
}

function saveCatalog(c: Catalog): void {
  // Sort models by id so diffs stay clean. Keep one model per line by
  // writing the top-level object pretty-printed but jamming each model's
  // object onto one line — matches the hand-authored file.
  const sorted = [...c.models].sort((a, b) => a.id.localeCompare(b.id));
  const lines: string[] = [];
  lines.push("{");
  lines.push(`  "provider": ${JSON.stringify(c.provider)},`);
  lines.push(`  "source": ${JSON.stringify(c.source)},`);
  lines.push(`  "fetched_at": ${JSON.stringify(c.fetched_at)},`);
  lines.push(`  "defaults": ${JSON.stringify(c.defaults)},`);
  lines.push(`  "models": [`);
  sorted.forEach((m, i) => {
    const tail = i === sorted.length - 1 ? "" : ",";
    lines.push(`    ${JSON.stringify(m)}${tail}`);
  });
  lines.push("  ]");
  lines.push("}");
  lines.push("");
  fs.writeFileSync(catalogPath(c.provider), lines.join("\n"));
}

// ---- ansi -----------------------------------------------------------------

const NO_COLOR = process.env.NO_COLOR === "1" || !process.stdout.isTTY;
const c = {
  dim: (s: string) => (NO_COLOR ? s : `\x1b[2m${s}\x1b[0m`),
  bold: (s: string) => (NO_COLOR ? s : `\x1b[1m${s}\x1b[0m`),
  red: (s: string) => (NO_COLOR ? s : `\x1b[31m${s}\x1b[0m`),
  green: (s: string) => (NO_COLOR ? s : `\x1b[32m${s}\x1b[0m`),
  yellow: (s: string) => (NO_COLOR ? s : `\x1b[33m${s}\x1b[0m`),
  cyan: (s: string) => (NO_COLOR ? s : `\x1b[36m${s}\x1b[0m`),
};

// ---- arg parsing ----------------------------------------------------------

interface Args {
  _: string[];
  flags: Map<string, string | boolean>;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { _: [], flags: new Map() };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok.startsWith("--")) {
      const key = tok.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        a.flags.set(key, true);
      } else {
        a.flags.set(key, next);
        i += 1;
      }
    } else {
      a._.push(tok);
    }
  }
  return a;
}

function flag(args: Args, key: string): string | undefined {
  const v = args.flags.get(key);
  return typeof v === "string" ? v : undefined;
}

function bool(args: Args, key: string): boolean {
  return args.flags.get(key) === true || args.flags.get(key) === "true";
}

function requireProvider(args: Args): Provider {
  const p = flag(args, "provider");
  if (!p) throw new Error("missing --provider (nvidia | openrouter | hf)");
  if (p !== "nvidia" && p !== "openrouter" && p !== "hf") {
    throw new Error(`unknown provider: ${p}`);
  }
  return p;
}

// ---- list / search / show -------------------------------------------------

interface Row {
  provider: Provider;
  model: CatalogModel;
}

function collectRows(args: Args): Row[] {
  const prov = flag(args, "provider") as Provider | undefined;
  const modality = flag(args, "modality");
  const publisher = flag(args, "publisher");
  const tag = flag(args, "tag");
  const family = flag(args, "family");
  const providers: Provider[] = prov ? [prov] : ["nvidia", "openrouter", "hf"];
  const rows: Row[] = [];
  for (const p of providers) {
    try {
      const cat = loadCatalog(p);
      for (const m of cat.models) {
        if (modality && !m.modality.includes(modality as Modality)) continue;
        if (publisher && m.publisher !== publisher) continue;
        if (tag && !m.tags.includes(tag)) continue;
        if (family && (m.family ?? "") !== family) continue;
        rows.push({ provider: p, model: m });
      }
    } catch {
      // provider not yet cataloged — skip silently
    }
  }
  return rows;
}

function cmdList(args: Args): void {
  const asJson = bool(args, "json");
  const asTree = bool(args, "tree");
  const asTable = bool(args, "table");
  const rows = collectRows(args);

  if (asJson) {
    process.stdout.write(JSON.stringify(rows.map((r) => ({ provider: r.provider, ...r.model })), null, 2) + "\n");
    return;
  }
  if (!rows.length) {
    console.log(c.dim("no models match"));
    return;
  }
  if (asTree) return renderTree(rows);
  if (asTable) return renderTable(rows);

  // default compact view
  const widths = {
    provider: Math.max(...rows.map((r) => r.provider.length), 4),
    id: Math.max(...rows.map((r) => r.model.id.length), 2),
    modality: Math.max(...rows.map((r) => r.model.modality.join(",").length), 8),
    ctx: 7,
    p50: 7,
  };
  const header = [
    "prov".padEnd(widths.provider),
    "id".padEnd(widths.id),
    "modality".padEnd(widths.modality),
    "ctx".padStart(widths.ctx),
    "p50ms".padStart(widths.p50),
  ].join("  ");
  console.log(c.bold(header));
  console.log(c.dim("-".repeat(header.length)));
  for (const r of rows) {
    const ctx = r.model.context_window ? r.model.context_window.toLocaleString() : "-";
    const p50 = r.model.stats.p50_ms != null ? r.model.stats.p50_ms.toFixed(0) : "-";
    console.log(
      [
        r.provider.padEnd(widths.provider),
        r.model.id.padEnd(widths.id),
        r.model.modality.join(",").padEnd(widths.modality),
        ctx.padStart(widths.ctx),
        p50.padStart(widths.p50),
      ].join("  "),
    );
  }
  console.log(c.dim(`\n${rows.length} model(s)`));
}

// Group rows by publisher → family → models, indented tree view.
function renderTree(rows: Row[]): void {
  const byPub = new Map<string, Map<string, Row[]>>();
  for (const r of rows) {
    const pub = r.model.publisher || "unknown";
    const fam = r.model.family ?? r.model.tags.find((t) => t.startsWith("family:"))?.slice(7) ?? "—";
    const pubMap = byPub.get(pub) ?? new Map<string, Row[]>();
    const list = pubMap.get(fam) ?? [];
    list.push(r);
    pubMap.set(fam, list);
    byPub.set(pub, pubMap);
  }
  const pubs = [...byPub.keys()].sort();
  for (const pub of pubs) {
    const famMap = byPub.get(pub)!;
    const pubCount = [...famMap.values()].reduce((s, l) => s + l.length, 0);
    console.log(`${c.bold(c.cyan(pub))}  ${c.dim(`(${pubCount})`)}`);
    const fams = [...famMap.keys()].sort();
    fams.forEach((fam, fi) => {
      const isLastFam = fi === fams.length - 1;
      const famBranch = isLastFam ? "└── " : "├── ";
      const famColor = fam === "—" ? c.dim(fam) : c.yellow(fam);
      console.log(`${c.dim(famBranch)}${famColor}`);
      const list = famMap.get(fam)!.sort((a, b) => a.model.id.localeCompare(b.model.id));
      const famPrefix = isLastFam ? "    " : "│   ";
      list.forEach((r, mi) => {
        const isLastModel = mi === list.length - 1;
        const modBranch = isLastModel ? "└── " : "├── ";
        const ctx = r.model.context_window ? ` ${r.model.context_window.toLocaleString()}` : "";
        const mods = r.model.modality.join(",");
        const prov = c.dim(`[${r.provider}]`);
        console.log(
          `${c.dim(famPrefix + modBranch)}${r.model.id}  ${prov}  ${c.dim(mods + ctx)}`,
        );
      });
    });
    console.log("");
  }
  console.log(c.dim(`${rows.length} model(s)  ·  ${pubs.length} publisher(s)`));
}

// Wide table: publisher, id, family, modality, context, cutoff, curated-snippet.
function renderTable(rows: Row[]): void {
  const cols = [
    { key: "prov", w: 4 },
    { key: "publisher", w: 4 },
    { key: "id", w: 2 },
    { key: "family", w: 6 },
    { key: "modality", w: 8 },
    { key: "ctx", w: 7 },
    { key: "cutoff", w: 7 },
    { key: "curated", w: 30 },
  ] as const;
  type ColKey = (typeof cols)[number]["key"];
  const data: Record<ColKey, string>[] = rows.map((r) => ({
    prov: r.provider,
    publisher: r.model.publisher,
    id: r.model.id,
    family: r.model.family ?? "—",
    modality: r.model.modality.join(","),
    ctx: r.model.context_window ? r.model.context_window.toLocaleString() : "—",
    cutoff: r.model.notes.cutoff ?? "—",
    curated: firstSentence(r.model.notes.curated ?? "", 120),
  }));
  const widths: Record<string, number> = {};
  for (const { key, w } of cols) {
    widths[key] = Math.max(w, ...data.map((d) => d[key].length));
  }
  // clamp curated to terminal-ish width (hard cap)
  widths.curated = Math.min(widths.curated, 80);
  const pad = (s: string, k: string) => {
    const w = widths[k];
    if (s.length > w) return s.slice(0, w - 1) + "…";
    return s.padEnd(w);
  };
  const header = cols.map((col) => pad(col.key, col.key)).join("  ");
  console.log(c.bold(header));
  console.log(c.dim("-".repeat(header.length)));
  for (const d of data) {
    const line = cols
      .map((col) => {
        const raw = pad(d[col.key], col.key);
        if (col.key === "id") return c.bold(raw);
        if (col.key === "family") return d.family === "—" ? c.dim(raw) : c.yellow(raw);
        if (col.key === "prov" || col.key === "publisher") return c.cyan(raw);
        if (col.key === "curated") return c.dim(raw);
        return raw;
      })
      .join("  ");
    console.log(line);
  }
  console.log(c.dim(`\n${rows.length} model(s)`));
}

function cmdSearch(args: Args): void {
  const query = args._[1];
  if (!query) throw new Error("usage: search <query> [--provider X]");
  const q = query.toLowerCase();
  const prov = flag(args, "provider") as Provider | undefined;
  const providers: Provider[] = prov ? [prov] : ["nvidia", "openrouter", "hf"];
  for (const p of providers) {
    try {
      const cat = loadCatalog(p);
      for (const m of cat.models) {
        const hay = [
          m.id,
          m.display_name,
          m.publisher,
          m.tags.join(" "),
          m.notes.curated ?? "",
          m.modality.join(" "),
        ]
          .join(" ")
          .toLowerCase();
        if (hay.includes(q)) {
          console.log(
            `${c.cyan(p.padEnd(10))} ${c.bold(m.id)}  ${c.dim(m.modality.join(","))}${
              m.notes.curated ? "  — " + c.dim(m.notes.curated) : ""
            }`,
          );
        }
      }
    } catch {
      // skip
    }
  }
}

function cmdShow(args: Args): void {
  const id = args._[1];
  if (!id) throw new Error("usage: show <model-id>");
  for (const p of ["nvidia", "openrouter", "hf"] as Provider[]) {
    try {
      const cat = loadCatalog(p);
      const m = cat.models.find((x) => x.id === id);
      if (m) {
        console.log(c.bold(`${p}  ${m.id}`));
        console.log(c.dim(`  api_base: ${cat.defaults.api_base}`));
        console.log(`  display    : ${m.display_name}`);
        console.log(`  publisher  : ${m.publisher}`);
        console.log(`  modality   : ${m.modality.join(", ")}`);
        console.log(`  context    : ${m.context_window?.toLocaleString() ?? "?"}`);
        console.log(`  pricing    : ${m.pricing ? JSON.stringify(m.pricing) : "free / inherit"}`);
        console.log(`  rate_limits: ${JSON.stringify(m.rate_limits ?? cat.defaults.rate_limits)}`);
        console.log(`  tags       : ${m.tags.join(", ")}`);
        console.log(`  cutoff     : ${m.notes.cutoff ?? c.dim("unknown")}`);
        if (m.notes.curated) console.log(`  notes      : ${m.notes.curated}`);
        console.log(c.bold("  stats:"));
        console.log(`    p50_ms         : ${m.stats.p50_ms ?? c.dim("none")}`);
        console.log(`    p95_ms         : ${m.stats.p95_ms ?? c.dim("none")}`);
        console.log(`    calls (last 30d): ${m.stats.calls_last_30d}`);
        console.log(`    last_measured  : ${m.stats.last_measured ?? c.dim("never")}`);
        if (m.stats.last_error) console.log(c.red(`    last_error     : ${m.stats.last_error}`));
        return;
      }
    } catch {
      // skip
    }
  }
  console.log(c.red(`not found: ${id}`));
  process.exitCode = 1;
}

// ---- refresh --------------------------------------------------------------

interface OpenAIModelsResponse {
  data?: Array<{ id: string; object?: string }>;
}

async function refreshNvidia(dry: boolean, yes: boolean): Promise<void> {
  const cat = loadCatalog("nvidia");
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    throw new Error("NVIDIA_API_KEY not set — export it or add to .env.local");
  }
  const url = `${cat.defaults.api_base}/models`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const body = (await res.json()) as OpenAIModelsResponse;
  const liveIds = new Set((body.data ?? []).map((m) => m.id));
  const localIds = new Set(cat.models.map((m) => m.id));

  const added = [...liveIds].filter((id) => !localIds.has(id));
  const removed = [...localIds].filter((id) => !liveIds.has(id));
  const unchanged = [...localIds].filter((id) => liveIds.has(id));

  console.log(c.bold(`nvidia refresh — ${new Date().toISOString()}`));
  console.log(`  live  : ${liveIds.size}`);
  console.log(`  local : ${localIds.size}`);
  console.log(`  ${c.green("+ added")}   : ${added.length}`);
  for (const id of added.slice(0, 30)) console.log(c.green(`    + ${id}`));
  if (added.length > 30) console.log(c.dim(`    … ${added.length - 30} more`));
  console.log(`  ${c.red("- removed")} : ${removed.length}`);
  for (const id of removed.slice(0, 30)) console.log(c.red(`    - ${id}`));
  if (removed.length > 30) console.log(c.dim(`    … ${removed.length - 30} more`));
  console.log(`  = unchanged: ${unchanged.length}`);

  if (dry) {
    console.log(c.dim("\ndry run — not writing"));
    return;
  }
  if (added.length === 0 && removed.length === 0) {
    // still bump fetched_at so we know we verified
    cat.fetched_at = new Date().toISOString();
    saveCatalog(cat);
    console.log(c.dim("\nno changes; updated fetched_at"));
    return;
  }
  if (!yes) {
    console.log(
      c.yellow(
        "\nUse --yes to apply. Added models are appended with null metadata; " +
          "curate their display_name / notes / context_window after.",
      ),
    );
    return;
  }
  // Apply: drop removed, add new stubs.
  const kept = cat.models.filter((m) => liveIds.has(m.id));
  const stubs: CatalogModel[] = added.map((id) => ({
    id,
    publisher: id.split("/")[0] ?? "unknown",
    display_name: prettify(id),
    modality: ["text"],
    context_window: null,
    max_output: null,
    pricing: null,
    rate_limits: null,
    tags: ["free"],
    notes: { cutoff: null, curated: null },
    stats: { p50_ms: null, p95_ms: null, calls_last_30d: 0, last_measured: null, last_error: null },
  }));
  cat.models = [...kept, ...stubs];
  cat.fetched_at = new Date().toISOString();
  saveCatalog(cat);
  console.log(c.green(`\nwrote ${catalogPath("nvidia")}`));
}

interface OpenRouterApiModel {
  id: string;
  name?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  architecture?: { modality?: string; input_modalities?: string[] };
  top_provider?: { max_completion_tokens?: number };
}

async function refreshOpenRouter(dry: boolean, _yes: boolean): Promise<void> {
  const url = "https://openrouter.ai/api/v1/models";
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { data?: OpenRouterApiModel[] };
  const live = body.data ?? [];
  console.log(c.bold(`openrouter refresh — ${new Date().toISOString()}`));
  console.log(`  live: ${live.length} models`);

  const file = catalogPath("openrouter");
  const existing: Catalog | null = fs.existsSync(file)
    ? (JSON.parse(fs.readFileSync(file, "utf8")) as Catalog)
    : null;

  const models: CatalogModel[] = live.map((m) => {
    const isFree = m.pricing?.prompt === "0" && m.pricing?.completion === "0";
    const modality = orModality(m);
    const prior = existing?.models.find((x) => x.id === m.id);
    const tags = new Set<string>(prior?.tags ?? []);
    if (isFree) tags.add("free");
    if ((m.context_length ?? 0) >= 128_000) tags.add("long-context");
    return {
      id: m.id,
      publisher: m.id.split("/")[0] ?? "unknown",
      display_name: m.name ?? prettify(m.id),
      modality,
      context_window: m.context_length ?? null,
      max_output: m.top_provider?.max_completion_tokens ?? null,
      pricing: isFree
        ? null
        : {
            prompt_per_mtok: parsePrice(m.pricing?.prompt),
            completion_per_mtok: parsePrice(m.pricing?.completion),
          },
      rate_limits: null,
      tags: [...tags].sort(),
      notes: prior?.notes ?? { cutoff: null, curated: null },
      stats: prior?.stats ?? {
        p50_ms: null,
        p95_ms: null,
        calls_last_30d: 0,
        last_measured: null,
        last_error: null,
      },
    };
  });

  const added = existing
    ? models.filter((m) => !existing.models.find((x) => x.id === m.id)).length
    : models.length;
  const removed = existing
    ? existing.models.filter((m) => !models.find((x) => x.id === m.id)).length
    : 0;
  console.log(`  ${c.green("+ added")}   : ${added}`);
  console.log(`  ${c.red("- removed")} : ${removed}`);

  if (dry) {
    console.log(c.dim("\ndry run — not writing"));
    return;
  }
  const cat: Catalog = {
    provider: "openrouter",
    source: "https://openrouter.ai/api/v1/models",
    fetched_at: new Date().toISOString(),
    defaults: {
      api_base: "https://openrouter.ai/api/v1",
      rate_limits: null,
      pricing: null,
      auth: "bearer",
      env_key: "OPENROUTER_API_KEY",
    },
    models,
  };
  saveCatalog(cat);
  console.log(c.green(`wrote ${file}`));
}

function orModality(m: OpenRouterApiModel): Modality[] {
  const mods = new Set<Modality>();
  const inputs = m.architecture?.input_modalities ?? [];
  if (inputs.includes("image") || inputs.includes("video")) mods.add("multimodal");
  else mods.add("text");
  const arch = m.architecture?.modality ?? "";
  if (arch.includes("image") && arch.includes("+")) mods.add("multimodal");
  if (arch === "text->image") return ["image_gen"];
  return [...mods];
}

function parsePrice(s: string | undefined): number {
  if (!s) return 0;
  // OpenRouter pricing is USD per-token string; normalize to per-Mtok.
  const n = Number(s);
  if (Number.isNaN(n)) return 0;
  return +(n * 1_000_000).toFixed(4);
}

interface DbLike {
  prepare(sql: string): { all(...args: unknown[]): unknown[] };
  close(): void;
}

async function openDb(dbPath: string): Promise<DbLike> {
  // Prefer bun:sqlite when running under Bun — avoids the native-ABI
  // mismatch between Electron-rebuilt better-sqlite3 and plain Node.
  // better-sqlite3 stays as the fallback for `tsx`/node invocations.
  if (typeof (globalThis as { Bun?: unknown }).Bun !== "undefined") {
    const mod = (await import("bun:sqlite")) as typeof import("bun:sqlite");
    return new mod.Database(dbPath, { readonly: true }) as unknown as DbLike;
  }
  const mod = await import("better-sqlite3");
  const Database = (mod as unknown as { default: new (p: string, o?: object) => DbLike }).default;
  return new Database(dbPath, { readonly: true });
}

async function refreshHf(dry: boolean, _yes: boolean): Promise<void> {
  // HF is usage-driven: read runs table, filter to HF-style model ids,
  // write a small catalog of what this deck has actually called.
  const dbPath = resolveDbPath();
  if (!fs.existsSync(dbPath)) {
    throw new Error(`no deck db at ${dbPath} — run the app at least once`);
  }
  const db = await openDb(dbPath);

  // Heuristic: HF ids are "<org>/<model>" but NOT in the nvidia or
  // openrouter catalogs we already track. This is imperfect — if you
  // deliberately use an HF endpoint with a name that collides with a NIM
  // model, it won't appear here. Good enough for v1.
  const knownIds = new Set<string>();
  for (const p of ["nvidia", "openrouter"] as Provider[]) {
    try {
      for (const m of loadCatalog(p).models) knownIds.add(m.id);
    } catch {
      // skip
    }
  }

  const rows = db
    .prepare(
      `SELECT model, COUNT(*) as calls,
              MIN(started_at) as first_seen,
              MAX(started_at) as last_seen
       FROM runs WHERE model IS NOT NULL AND model != '' GROUP BY model`,
    )
    .all() as Array<{ model: string; calls: number; first_seen: string; last_seen: string }>;
  db.close();

  const hfRows = rows.filter((r) => r.model.includes("/") && !knownIds.has(r.model));
  console.log(c.bold(`hf refresh (usage-driven) — ${new Date().toISOString()}`));
  console.log(`  distinct HF models invoked: ${hfRows.length}`);

  if (dry) {
    for (const r of hfRows) console.log(`  ${r.model}  (${r.calls} calls)`);
    return;
  }

  const file = catalogPath("hf");
  const existing: Catalog | null = fs.existsSync(file)
    ? (JSON.parse(fs.readFileSync(file, "utf8")) as Catalog)
    : null;

  const models: CatalogModel[] = hfRows.map((r) => {
    const prior = existing?.models.find((x) => x.id === r.model);
    return (
      prior ?? {
        id: r.model,
        publisher: r.model.split("/")[0] ?? "unknown",
        display_name: prettify(r.model),
        modality: ["text"],
        context_window: null,
        max_output: null,
        pricing: null,
        rate_limits: null,
        tags: ["usage-seen"],
        notes: { cutoff: null, curated: `first seen ${r.first_seen}` },
        stats: {
          p50_ms: null,
          p95_ms: null,
          calls_last_30d: 0,
          last_measured: null,
          last_error: null,
        },
      }
    );
  });

  const cat: Catalog = {
    provider: "hf",
    source: "usage-derived (data/deck.db runs table)",
    fetched_at: new Date().toISOString(),
    defaults: {
      api_base: "https://api-inference.huggingface.co",
      rate_limits: null,
      pricing: null,
      auth: "bearer",
      env_key: "HUGGINGFACE_API_KEY",
    },
    models,
  };
  saveCatalog(cat);
  console.log(c.green(`wrote ${file}`));
}

function prettify(id: string): string {
  const stem = id.split("/").pop() ?? id;
  return stem
    .split(/[-_]/)
    .map((s) => (s.length ? s[0].toUpperCase() + s.slice(1) : s))
    .join(" ");
}

async function cmdRefresh(args: Args): Promise<void> {
  const p = requireProvider(args);
  const dry = bool(args, "dry");
  const yes = bool(args, "yes");
  if (p === "nvidia") return refreshNvidia(dry, yes);
  if (p === "openrouter") return refreshOpenRouter(dry, yes);
  if (p === "hf") return refreshHf(dry, yes);
}

// ---- probe ----------------------------------------------------------------

async function cmdProbe(args: Args): Promise<void> {
  const id = args._[1];
  if (!id) throw new Error("usage: probe <model-id> [--provider X] [--prompt \"...\"]");
  const prompt = flag(args, "prompt") ?? "reply with the single word OK";
  const provArg = flag(args, "provider") as Provider | undefined;
  // find the catalog that has this model
  let prov: Provider | null = provArg ?? null;
  let cat: Catalog | null = null;
  let model: CatalogModel | null = null;
  const tryList: Provider[] = prov ? [prov] : ["nvidia", "openrouter", "hf"];
  for (const p of tryList) {
    try {
      const loaded = loadCatalog(p);
      const m = loaded.models.find((x) => x.id === id);
      if (m) {
        prov = p;
        cat = loaded;
        model = m;
        break;
      }
    } catch {
      // skip
    }
  }
  if (!prov || !cat || !model) throw new Error(`model not in any catalog: ${id}`);

  const apiKey = process.env[cat.defaults.env_key];
  if (!apiKey) throw new Error(`${cat.defaults.env_key} not set`);

  const url = `${cat.defaults.api_base}/chat/completions`;
  const t0 = Date.now();
  let latencyMs: number | null = null;
  let errMsg: string | null = null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: id,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 16,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    latencyMs = Date.now() - t0;
    if (!res.ok) {
      errMsg = `HTTP ${res.status} ${res.statusText}`;
      const text = await res.text().catch(() => "");
      if (text) errMsg += ": " + text.slice(0, 200);
    } else {
      const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = j.choices?.[0]?.message?.content ?? "";
      console.log(c.bold(`probe ${prov}/${id}`));
      console.log(`  latency_ms: ${c.cyan(String(latencyMs))}`);
      console.log(`  response  : ${content.slice(0, 80).replace(/\n/g, " ")}`);
    }
  } catch (e) {
    latencyMs = Date.now() - t0;
    errMsg = e instanceof Error ? e.message : String(e);
  }

  // persist into catalog: single-sample p50 == latency, p95 same.
  // stats command will overwrite with real percentiles from runs table.
  model.stats.last_measured = new Date().toISOString();
  if (errMsg) {
    model.stats.last_error = errMsg;
    console.log(c.red(`  error: ${errMsg}`));
    process.exitCode = 1;
  } else {
    model.stats.last_error = null;
    model.stats.p50_ms = latencyMs;
    if (model.stats.p95_ms == null) model.stats.p95_ms = latencyMs;
  }
  saveCatalog(cat);
}

// ---- stats ----------------------------------------------------------------

async function cmdStats(args: Args): Promise<void> {
  const provArg = flag(args, "provider") as Provider | undefined;
  const days = Number(flag(args, "days") ?? 30);
  const dbPath = resolveDbPath();
  if (!fs.existsSync(dbPath)) throw new Error(`no deck db at ${dbPath}`);
  const db = await openDb(dbPath);

  const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
  const rows = db
    .prepare(
      `SELECT model,
              started_at, ended_at
       FROM runs
       WHERE model IS NOT NULL AND model != ''
         AND started_at >= ?
         AND ended_at IS NOT NULL`,
    )
    .all(cutoff) as Array<{ model: string; started_at: string; ended_at: string }>;
  db.close();

  // group durations per model
  const perModel = new Map<string, number[]>();
  for (const r of rows) {
    const ms = Date.parse(r.ended_at) - Date.parse(r.started_at);
    if (Number.isFinite(ms) && ms >= 0) {
      const list = perModel.get(r.model) ?? [];
      list.push(ms);
      perModel.set(r.model, list);
    }
  }

  const providers: Provider[] = provArg ? [provArg] : ["nvidia", "openrouter", "hf"];
  let totalUpdated = 0;
  for (const p of providers) {
    let cat: Catalog;
    try {
      cat = loadCatalog(p);
    } catch {
      continue;
    }
    let changed = 0;
    for (const m of cat.models) {
      const durs = perModel.get(m.id);
      if (!durs || durs.length === 0) continue;
      durs.sort((a, b) => a - b);
      const p50 = durs[Math.floor(durs.length * 0.5)];
      const p95 = durs[Math.floor(durs.length * 0.95)];
      m.stats.p50_ms = p50;
      m.stats.p95_ms = p95;
      m.stats.calls_last_30d = durs.length;
      m.stats.last_measured = new Date().toISOString();
      changed += 1;
    }
    if (changed > 0) {
      saveCatalog(cat);
      totalUpdated += changed;
      console.log(c.green(`${p}: updated stats for ${changed} models`));
    } else {
      console.log(c.dim(`${p}: no runs matched`));
    }
  }
  console.log(c.bold(`\ntotal models updated: ${totalUpdated}`));
}

// ---- constellation --------------------------------------------------------

// Clusters models into "constellations" by family, rendered as boxed cards
// laid out in columns across the terminal. Each card lists member model ids
// and highlights base-model edges ("← <base>") in dim text beside derivatives.
function cmdConstellation(args: Args): void {
  const rows = collectRows(args);
  if (!rows.length) {
    console.log(c.dim("no models match"));
    return;
  }
  // group by publisher+family so Meta's llama-3 and a third-party llama-3
  // fine-tune don't collide visually.
  const clusters = new Map<string, Row[]>();
  for (const r of rows) {
    const fam = r.model.family ?? r.model.tags.find((t) => t.startsWith("family:"))?.slice(7) ?? "unclassified";
    const key = `${r.model.publisher}::${fam}`;
    const list = clusters.get(key) ?? [];
    list.push(r);
    clusters.set(key, list);
  }

  // sort clusters by size desc — the big players come first, loners at end.
  const sorted = [...clusters.entries()].sort((a, b) => b[1].length - a[1].length);

  const termCols = Number(process.env.COLUMNS) || (process.stdout.columns ?? 100);
  const cardW = 34;
  const perRow = Math.max(1, Math.floor(termCols / (cardW + 2)));

  // Build each card as an array of lines (same height for grid alignment).
  const cards = sorted.map(([key, list]) => buildCard(key, list, cardW));
  const maxLines = Math.max(...cards.map((c) => c.length));
  for (const card of cards) {
    while (card.length < maxLines) card.push(" ".repeat(cardW));
  }

  // Emit in grid rows of `perRow` cards.
  for (let i = 0; i < cards.length; i += perRow) {
    const row = cards.slice(i, i + perRow);
    for (let ln = 0; ln < maxLines; ln++) {
      console.log(row.map((card) => card[ln]).join("  "));
    }
    console.log(""); // gutter
  }

  // Footer summary + modality legend.
  const modalityCounts = new Map<string, number>();
  for (const r of rows) for (const m of r.model.modality) modalityCounts.set(m, (modalityCounts.get(m) ?? 0) + 1);
  const summary = [...modalityCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([m, n]) => `${m}:${n}`)
    .join("  ");
  console.log(c.dim(`${rows.length} model(s)  ·  ${clusters.size} constellation(s)  ·  ${summary}`));
}

function buildCard(key: string, list: Row[], width: number): string[] {
  const [pub, fam] = key.split("::");
  const title = `${pub} / ${fam === "unclassified" ? c.dim(fam) : c.yellow(fam)}`;
  const topBar = "┌" + "─".repeat(width - 2) + "┐";
  const botBar = "└" + "─".repeat(width - 2) + "┘";
  const lines: string[] = [c.dim(topBar)];
  lines.push(padBox(title, width));
  lines.push(c.dim("├" + "─".repeat(width - 2) + "┤"));

  // largest context → top of card, tends to put flagships first
  const sorted = [...list].sort((a, b) => (b.model.context_window ?? 0) - (a.model.context_window ?? 0));
  const byId = new Map(list.map((r) => [r.model.id, r] as const));
  for (const r of sorted) {
    const stem = r.model.id.split("/").pop() ?? r.model.id;
    const ctx = r.model.context_window ? formatCtx(r.model.context_window) : "";
    const mod = r.model.modality.length > 1 ? "★" : modalityGlyph(r.model.modality[0]);
    const edge = r.model.base_model && byId.has(r.model.base_model)
      ? c.dim(` ← ${r.model.base_model.split("/").pop()}`)
      : "";
    const line = `${mod} ${stem}${edge ? edge : ""}${ctx ? " " + c.dim(ctx) : ""}`;
    lines.push(padBox(line, width));
  }
  // append curated snippet for family (from the longest one)
  const curated = sorted.find((r) => r.model.notes.curated)?.model.notes.curated;
  if (curated) {
    const wrapped = wrapText(curated, width - 4).slice(0, 2);
    lines.push(c.dim("├" + "─".repeat(width - 2) + "┤"));
    for (const w of wrapped) lines.push(padBox(c.dim(w), width));
  }
  lines.push(c.dim(botBar));
  return lines;
}

function padBox(content: string, width: number): string {
  const inner = width - 2;
  const visible = stripAnsi(content);
  let body: string;
  if (visible.length > inner) {
    // hard-truncate visible chars, preserving intent
    const truncated = visible.slice(0, inner - 1) + "…";
    body = truncated;
  } else {
    body = content + " ".repeat(inner - visible.length);
  }
  return c.dim("│") + body + c.dim("│");
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function wrapText(s: string, width: number): string[] {
  const words = s.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > width) {
      if (cur) lines.push(cur);
      cur = w;
    } else {
      cur = cur ? cur + " " + w : w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// First sentence (or first `cap` chars), respecting abbreviations like
// "Llama 3.2" and acronyms. Splits on ". " or ".\n" — not on bare dot.
function firstSentence(s: string, cap: number): string {
  if (!s) return "";
  const m = s.match(/^(.*?[.!?])(\s|$)/);
  const head = m ? m[1] : s;
  return head.length > cap ? head.slice(0, cap - 1) + "…" : head;
}

function formatCtx(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(0) + "K";
  return String(n);
}

function modalityGlyph(m: Modality | undefined): string {
  switch (m) {
    case "text": return "◦";
    case "vision": return "◉";
    case "multimodal": return "★";
    case "embedding": return "≡";
    case "reranker": return "⇅";
    case "image_gen": return "▣";
    case "video_gen": return "▶";
    case "3d_gen": return "◇";
    case "speech": return "♪";
    case "safety": return "⊗";
    case "ocr": return "Ⓡ";
    case "object_detection": return "▢";
    case "bio": return "⚗";
    case "climate": return "☁";
    case "optimization": return "∑";
    default: return "·";
  }
}

// ---- classify ------------------------------------------------------------

// Rule-based family/base-model classifier for models without curated notes.
// Rules are ordered; first match wins. `base` is a function when inference
// depends on the concrete id (e.g. a dolphin fine-tune's parent varies).
interface ClassifyRule {
  test: RegExp;
  family: string;
  base?: (id: string, name: string) => string | null;
}

// Order matters: more-specific rules first. All tests run on the stem
// (post-slash) lowercased; a few publisher-qualified rules check the whole id.
const CLASSIFY_RULES: ClassifyRule[] = [
  // --- first-party proprietary lines (no open base_model) ---
  { test: /^ernie-x/, family: "ernie-x" },
  { test: /^ernie-4\.5/, family: "ernie-4.5" },
  { test: /^ernie/, family: "ernie" },
  { test: /^jamba/, family: "jamba" },
  { test: /^nova(-|$)/, family: "nova" },
  { test: /^command-(r|a)/, family: "command-r" },
  { test: /^aya/, family: "aya" },
  { test: /^grok-(4|5)/, family: "grok" },
  { test: /^grok-/, family: "grok" },
  { test: /^claude-(opus|sonnet|haiku)/, family: "claude" },
  { test: /^claude/, family: "claude" },
  { test: /^gpt-(5|5\.)/, family: "gpt-5" },
  { test: /^gpt-4o/, family: "gpt-4o" },
  { test: /^gpt-4(-|\.|$)/, family: "gpt-4" },
  { test: /^gpt-audio/, family: "gpt-audio" },
  { test: /^gpt-3\.5/, family: "gpt-3.5" },
  { test: /^o(1|3|4)(-|$)/, family: "openai-o-reasoning" },
  { test: /^gemini-(2|3)/, family: "gemini" },
  { test: /^gemini/, family: "gemini" },
  { test: /^sonar/, family: "sonar" },
  { test: /^ui-tars/, family: "ui-tars" },
  { test: /^aion-rp-/, family: "aion-rp", base: (id) => baseFromSubstring(id) },
  { test: /^aion-/, family: "aion" },

  // --- byte-dance seed + tongyi ---
  { test: /^seed-(oss|1|2)/, family: "seed" },
  { test: /^tongyi/, family: "tongyi" },

  // --- open-weights flagship families ---
  { test: /llama-?4/, family: "llama-4", base: (id) => baseFromSubstring(id) },
  { test: /llama-?3\.3/, family: "llama-3", base: (id) => baseFromSubstring(id) },
  { test: /llama-?3\.2/, family: "llama-3", base: (id) => baseFromSubstring(id) },
  { test: /llama-?3\.1/, family: "llama-3", base: (id) => baseFromSubstring(id) },
  { test: /llama-?3(?!\.[456789])/, family: "llama-3", base: (id) => baseFromSubstring(id) },
  { test: /llama-?2/, family: "llama-2", base: (id) => baseFromSubstring(id) },
  // Short-form "l3-" / "l3.1" / "l2-" used by community fine-tunes (sao10k, undi95).
  { test: /^l3(\.1|\.2|\.3)?-/, family: "llama-3", base: () => "meta/llama-3" },
  { test: /^l2-/, family: "llama-2", base: () => "meta/llama-2" },
  { test: /llama-?guard/, family: "llama-guard" },
  { test: /codellama/, family: "codellama", base: (id) => baseFromSubstring(id) },
  { test: /qwen3-?coder/, family: "qwen-3-coder" },
  { test: /qwen-?3/, family: "qwen-3", base: (id) => baseFromSubstring(id) },
  { test: /qwen-?2\.5/, family: "qwen-2.5", base: (id) => baseFromSubstring(id) },
  { test: /qwen-?2/, family: "qwen-2", base: (id) => baseFromSubstring(id) },
  { test: /qwq/, family: "qwq" },
  { test: /qvq/, family: "qvq" },
  { test: /qwen-?vl/, family: "qwen-vl" },
  { test: /qwen/, family: "qwen" },
  { test: /deepseek-?v3\.2/, family: "deepseek-v3" },
  { test: /deepseek-?v3/, family: "deepseek-v3" },
  { test: /deepseek-?v2/, family: "deepseek-v2" },
  { test: /deepseek-?r1/, family: "deepseek-r1", base: (id) => /distill/i.test(id) ? baseFromSubstring(id) : null },
  { test: /deepseek-?prover/, family: "deepseek-prover" },
  { test: /deepseek-?coder/, family: "deepseek-coder" },
  { test: /deepseek-?chat/, family: "deepseek-v3" },
  { test: /deepseek/, family: "deepseek" },
  { test: /glm-?4\.5/, family: "glm-4.5" },
  { test: /glm-?4\.6/, family: "glm-4.6" },
  { test: /glm-?5/, family: "glm-5" },
  { test: /glm-?4/, family: "glm-4" },
  { test: /glm/, family: "glm" },
  { test: /chatglm/, family: "glm" },
  { test: /kimi-?k2/, family: "kimi-k2" },
  { test: /kimi/, family: "kimi" },
  { test: /minimax-?m[12]/, family: "minimax-m" },
  { test: /minimax/, family: "minimax" },
  { test: /mistral-?large/, family: "mistral-large" },
  { test: /mistral-?medium/, family: "mistral-medium" },
  { test: /mistral-?small/, family: "mistral-small" },
  { test: /mistral-?nemo/, family: "mistral-nemo" },
  { test: /mixtral-?8x22/, family: "mixtral" },
  { test: /mixtral/, family: "mixtral" },
  { test: /codestral/, family: "codestral" },
  { test: /devstral/, family: "devstral" },
  { test: /pixtral/, family: "pixtral" },
  { test: /ministral/, family: "ministral" },
  { test: /magistral/, family: "magistral" },
  { test: /mistral-?7b/, family: "mistral-7b" },
  { test: /mistral/, family: "mistral" },
  { test: /gemma-?3n/, family: "gemma-3" },
  { test: /gemma-?3/, family: "gemma-3" },
  { test: /gemma-?2/, family: "gemma-2" },
  { test: /gemma/, family: "gemma-1" },
  { test: /medgemma/, family: "medgemma", base: () => null },
  { test: /shieldgemma/, family: "shieldgemma" },
  { test: /phi-?4/, family: "phi-4" },
  { test: /phi-?3/, family: "phi-3" },
  { test: /phi-?2/, family: "phi-2" },
  { test: /phi-?mini|^phi$/, family: "phi-3" },
  { test: /nemotron-?nano/, family: "nemotron-nano" },
  { test: /nemotron-?ultra/, family: "nemotron-ultra" },
  { test: /nemotron-?super/, family: "nemotron-super" },
  { test: /nemotron/, family: "nemotron" },
  { test: /gpt-?oss/, family: "gpt-oss" },

  // --- well-known fine-tune lines (base derived from id/name) ---
  { test: /dolphin/, family: "dolphin", base: (id) => baseFromSubstring(id) },
  { test: /hermes-?(3|4)/, family: "hermes", base: (id) => baseFromSubstring(id) },
  { test: /hermes/, family: "hermes", base: (id) => baseFromSubstring(id) },
  { test: /wizardlm/, family: "wizardlm", base: (id) => baseFromSubstring(id) },
  { test: /euryale/, family: "euryale", base: (id) => baseFromSubstring(id) },
  { test: /lumimaid/, family: "lumimaid", base: (id) => baseFromSubstring(id) },
  { test: /mythomax|mytho/, family: "mythomax", base: (id) => baseFromSubstring(id) },
  { test: /magnum/, family: "magnum", base: (id) => baseFromSubstring(id) },
  { test: /midnight-rose/, family: "midnight-rose", base: (id) => baseFromSubstring(id) },
  { test: /weaver/, family: "weaver", base: (id) => baseFromSubstring(id) },
  { test: /airoboros/, family: "airoboros", base: (id) => baseFromSubstring(id) },
  { test: /goliath/, family: "goliath", base: (id) => baseFromSubstring(id) },
  { test: /stheno/, family: "stheno", base: (id) => baseFromSubstring(id) },
  { test: /saiga/, family: "saiga", base: (id) => baseFromSubstring(id) },
  { test: /solar/, family: "solar" },
  { test: /dracarys/, family: "dracarys", base: (id) => baseFromSubstring(id) },
  { test: /cogito/, family: "cogito" },

  // --- specialty ---
  { test: /yi-(34|6|1\.5)/, family: "yi" },
  { test: /yi-/, family: "yi" },
  { test: /^yi$/, family: "yi" },
  { test: /granite/, family: "granite" },
  { test: /olmo/, family: "olmo" },
  { test: /falcon/, family: "falcon" },
  { test: /starcoder/, family: "starcoder" },
  { test: /smol/, family: "smollm" },
  { test: /moonlight/, family: "moonlight" },
  { test: /inflection/, family: "inflection" },
  { test: /palmyra/, family: "palmyra" },
  { test: /reka/, family: "reka" },
  { test: /liquid|lfm-/, family: "lfm" },
  { test: /sorcerer/, family: "sorcerer", base: (id) => baseFromSubstring(id) },
  { test: /trinity|virtuoso|maestro|spotlight/, family: "arcee" },
  { test: /seallm|sealion|sea-lion|meralion/, family: "sea-lion" },
  { test: /arctic/, family: "arctic" },
  { test: /sarvam|hanooman|airavata/, family: "indic" },
  { test: /stockmark|rakuten|karakuri|japanese-stablelm|plamo/, family: "japanese" },
  { test: /goku|baichuan|internlm|chatglm/, family: "chinese-misc" },

  // --- catch-all publisher-scoped rules (run last, only on stems that
  //     earlier rules didn't claim) ---
  { test: /^hunyuan|^hy\d/, family: "hunyuan" },
  { test: /^mimo/, family: "mimo" },
  { test: /^step-|^step\d/, family: "stepfun" },
  { test: /^ling-/, family: "ling" },
  { test: /^lyria/, family: "lyria" },
  { test: /^mercury/, family: "mercury" },
  { test: /^morph/, family: "morph" },
  { test: /^relace/, family: "relace" },
  { test: /^intellect/, family: "intellect" },
  { test: /^kat-coder|^kat\d/, family: "kat-coder" },
  { test: /^qianfan/, family: "qianfan" },
  { test: /^rnj-/, family: "rnj" },
  { test: /^coder-large$/, family: "arcee" },
  { test: /^(auto|free|bodybuilder|pareto-code|router)$/, family: "router-meta" },
  // TheDrummer's RP fine-tunes (Cydonia on Mistral-Small, Rocinante/Skyfall/UnslopNemo on Mistral-Nemo).
  { test: /^cydonia/, family: "drummer-rp", base: () => "mistralai/mistral-small" },
  { test: /^rocinante|^skyfall|^unslopnemo/, family: "drummer-rp", base: () => "mistralai/mistral-nemo" },
  // Undi95's legacy Llama-2 slerp merges.
  { test: /^remm/, family: "llama-2", base: () => "meta/llama-2" },
];

// Peel a base-model hint out of an id like
// "cognitivecomputations/dolphin-2.9-llama3-8b" → "meta/llama-3".
// Best-effort; used where a family rule carries `base`. Returns a plausible
// canonical base id but doesn't assert the parent is actually in the catalog.
function baseFromSubstring(id: string): string | null {
  const s = id.toLowerCase();
  if (/llama-?3\.3|llama3?\.3/.test(s)) return "meta/llama-3.3-70b-instruct";
  if (/llama-?3\.2/.test(s)) return "meta/llama-3.2";
  if (/llama-?3\.1|llama3?\.1/.test(s)) return "meta/llama-3.1";
  if (/llama-?4/.test(s)) return "meta/llama-4";
  if (/llama-?3|llama3/.test(s)) return "meta/llama-3";
  if (/llama-?2|llama2/.test(s)) return "meta/llama-2";
  if (/qwen-?2\.5|qwen2\.5/.test(s)) return "qwen/qwen-2.5";
  if (/qwen-?3|qwen3/.test(s)) return "qwen/qwen-3";
  if (/qwen-?2|qwen2/.test(s)) return "qwen/qwen-2";
  if (/mixtral/.test(s)) return "mistralai/mixtral";
  if (/mistral-?nemo/.test(s)) return "mistralai/mistral-nemo";
  if (/mistral-?7b|mistral7b/.test(s)) return "mistralai/mistral-7b";
  if (/mistral/.test(s)) return "mistralai/mistral";
  if (/gemma-?3/.test(s)) return "google/gemma-3";
  if (/gemma-?2/.test(s)) return "google/gemma-2";
  if (/gemma/.test(s)) return "google/gemma";
  if (/deepseek-?v3/.test(s)) return "deepseek-ai/deepseek-v3";
  if (/deepseek-?r1/.test(s)) return "deepseek-ai/deepseek-r1";
  return null;
}

function classifyOne(m: CatalogModel): { family: string | null; base: string | null } {
  const stem = (m.id.split("/").pop() ?? m.id).toLowerCase();
  const name = m.display_name.toLowerCase();
  for (const rule of CLASSIFY_RULES) {
    if (rule.test.test(stem) || rule.test.test(name)) {
      const base = rule.base ? rule.base(m.id.toLowerCase(), name) : null;
      return { family: rule.family, base };
    }
  }
  return { family: null, base: null };
}

function cmdClassify(args: Args): void {
  const prov = flag(args, "provider") as Provider | undefined;
  const yes = bool(args, "yes");
  const providers: Provider[] = prov ? [prov] : ["nvidia", "openrouter", "hf"];
  let totalMatched = 0;
  const unmatched: string[] = [];
  for (const p of providers) {
    let cat: Catalog;
    try {
      cat = loadCatalog(p);
    } catch {
      continue;
    }
    let matched = 0;
    for (const m of cat.models) {
      if (m.family) continue;
      const r = classifyOne(m);
      if (!r.family) {
        unmatched.push(`${p}:${m.id}`);
        continue;
      }
      m.family = r.family;
      // only set base_model if undefined/null; don't stomp curated data
      if ((m.base_model === undefined || m.base_model === null) && r.base) {
        m.base_model = r.base;
      }
      matched += 1;
    }
    totalMatched += matched;
    if (matched > 0) {
      console.log(c.green(`${p}: classified ${matched} model(s)`));
      if (yes) {
        cat.fetched_at = new Date().toISOString();
        saveCatalog(cat);
      }
    } else {
      console.log(c.dim(`${p}: nothing to classify`));
    }
  }
  console.log(c.bold(`\ntotal matched: ${totalMatched}  ·  unmatched: ${unmatched.length}`));
  if (unmatched.length) {
    console.log(c.dim(`unmatched ids (${unmatched.length}):`));
    for (const id of unmatched) console.log(c.dim(`  - ${id}`));
  }
  if (!yes && totalMatched > 0) console.log(c.yellow(`\n--yes to persist.`));
}

// ---- merge ----------------------------------------------------------------

interface PatchEntry {
  id: string;
  family?: string | null;
  cutoff?: string | null;
  curated?: string | null;
  base_model?: string | null;
}

// Merge curated patches from research agents into nvidia + openrouter
// catalogs. Patches are JSON arrays of {id, family, cutoff, curated, base_model}.
// Usage: merge [--from <glob-or-file>] [--yes]
async function cmdMerge(args: Args): Promise<void> {
  const from = flag(args, "from") ?? "/tmp/catalog-research/bucket-*.json";
  const yes = bool(args, "yes");
  const files = expandPatchGlob(from);
  if (!files.length) throw new Error(`no patch files at: ${from}`);

  const patches: PatchEntry[] = [];
  for (const f of files) {
    const raw = JSON.parse(fs.readFileSync(f, "utf8"));
    if (!Array.isArray(raw)) {
      console.log(c.yellow(`skipping non-array patch: ${f}`));
      continue;
    }
    patches.push(...(raw as PatchEntry[]));
    console.log(c.dim(`loaded ${raw.length} entries from ${path.basename(f)}`));
  }

  // load both catalogs
  const targets: Provider[] = ["nvidia", "openrouter"];
  const cats = new Map<Provider, Catalog>();
  for (const p of targets) {
    try {
      cats.set(p, loadCatalog(p));
    } catch {
      console.log(c.dim(`no ${p} catalog — skipping`));
    }
  }

  let matched = 0;
  let unmatched = 0;
  const unmatchedIds: string[] = [];
  const touched = new Set<Provider>();

  for (const patch of patches) {
    let found = false;
    for (const [prov, cat] of cats) {
      const m = cat.models.find((x) => x.id === patch.id);
      if (!m) continue;
      found = true;
      matched += 1;
      if (patch.family !== undefined) m.family = patch.family;
      if (patch.base_model !== undefined) m.base_model = patch.base_model;
      if (patch.cutoff !== undefined) m.notes.cutoff = patch.cutoff;
      if (patch.curated !== undefined) m.notes.curated = patch.curated;
      touched.add(prov);
    }
    if (!found) {
      unmatched += 1;
      unmatchedIds.push(patch.id);
    }
  }

  console.log(c.bold(`\nmerge summary`));
  console.log(`  matched   : ${c.green(String(matched))}`);
  console.log(`  unmatched : ${c.yellow(String(unmatched))}`);
  if (unmatched > 0) {
    console.log(c.dim(`  (speculative ids not in either catalog:)`));
    for (const id of unmatchedIds.slice(0, 20)) console.log(c.dim(`    - ${id}`));
    if (unmatchedIds.length > 20) console.log(c.dim(`    … ${unmatchedIds.length - 20} more`));
  }

  if (!yes) {
    console.log(c.yellow(`\n--yes to persist. nothing written.`));
    return;
  }
  for (const p of touched) {
    const cat = cats.get(p)!;
    cat.fetched_at = new Date().toISOString();
    saveCatalog(cat);
    console.log(c.green(`wrote ${catalogPath(p)}`));
  }
}

function expandPatchGlob(pat: string): string[] {
  // minimal glob — only `*` in the basename is supported.
  if (!pat.includes("*")) return fs.existsSync(pat) ? [pat] : [];
  const dir = path.dirname(pat);
  const base = path.basename(pat);
  if (!fs.existsSync(dir)) return [];
  const re = new RegExp("^" + base.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
  return fs
    .readdirSync(dir)
    .filter((f) => re.test(f))
    .map((f) => path.join(dir, f))
    .sort();
}

// ---- families -------------------------------------------------------------

function cmdFamilies(args: Args): void {
  const rows = collectRows(args);
  const counts = new Map<string, { count: number; publishers: Set<string> }>();
  for (const r of rows) {
    const fam = r.model.family ?? "—";
    const e = counts.get(fam) ?? { count: 0, publishers: new Set<string>() };
    e.count += 1;
    e.publishers.add(r.model.publisher);
    counts.set(fam, e);
  }
  const entries = [...counts.entries()].sort((a, b) => b[1].count - a[1].count);
  const famW = Math.max(6, ...entries.map(([f]) => f.length));
  console.log(c.bold("family".padEnd(famW) + "  count  publishers"));
  console.log(c.dim("-".repeat(famW + 30)));
  for (const [fam, e] of entries) {
    const color = fam === "—" ? c.dim : c.yellow;
    console.log(`${color(fam.padEnd(famW))}  ${String(e.count).padStart(5)}  ${c.cyan([...e.publishers].sort().join(", "))}`);
  }
  console.log(c.dim(`\n${entries.length} distinct family value(s)`));
}

// ---- main -----------------------------------------------------------------

const USAGE = `
model-catalog — peruse and refresh model catalogs

  list [--provider X] [--modality M] [--publisher P] [--tag T] [--family F]
       [--tree | --table | --json]
  search <query> [--provider X]
  show <model-id>
  refresh --provider nvidia|openrouter|hf [--dry] [--yes]
  probe <model-id> [--provider X] [--prompt "..."]
  stats [--provider X] [--days 30]
  constellation [--provider X] [--modality M] [--publisher P] [--family F]
  families [--provider X]
  merge [--from <glob>] [--yes]
  classify [--provider X] [--yes]
`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const sub = args._[0];
  try {
    switch (sub) {
      case "list":
        cmdList(args);
        break;
      case "search":
        cmdSearch(args);
        break;
      case "show":
        cmdShow(args);
        break;
      case "refresh":
        await cmdRefresh(args);
        break;
      case "probe":
        await cmdProbe(args);
        break;
      case "stats":
        await cmdStats(args);
        break;
      case "constellation":
        cmdConstellation(args);
        break;
      case "families":
        cmdFamilies(args);
        break;
      case "merge":
        await cmdMerge(args);
        break;
      case "classify":
        cmdClassify(args);
        break;
      case undefined:
      case "help":
      case "--help":
      case "-h":
        console.log(USAGE);
        break;
      default:
        console.log(c.red(`unknown subcommand: ${sub}`));
        console.log(USAGE);
        process.exitCode = 2;
    }
  } catch (e) {
    console.error(c.red(e instanceof Error ? e.message : String(e)));
    process.exitCode = 1;
  }
}

void main();
