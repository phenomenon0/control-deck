/**
 * Free-tier roulette router.
 *
 * Walks an ordered catalog of free-tier models (OpenRouter `:free` suffix
 * for v1) and returns the first one with remaining quota for the current
 * minute and day. Counters live in-process; this is fine for single-node
 * dev + Electron use but would need Redis/SQLite to survive restarts or
 * scale horizontally.
 *
 * The catalog is seeded from r/clawdbot's 2026-04 snapshot. Real discovery
 * (`openrouter.ai/api/v1/models` → filter by `pricing.prompt === "0"`) is
 * a v2 concern; for v1 we just keep the list honest manually.
 *
 * Quota accounting:
 *   - RPM resets on a rolling 60s window.
 *   - RPD resets at midnight UTC (sane default for OpenRouter).
 *   - Explicit `markExhausted()` from a 429 takes precedence and locks
 *     the model for the remainder of the current minute OR day based on
 *     the error class.
 */

export type FreeTierProvider = "openrouter" | "nvidia";
export type FreeTierModality = "text" | "vision" | "multimodal" | "reasoning";

export interface FreeTierModel {
  id: string;
  provider: FreeTierProvider;
  displayName: string;
  contextWindow: number;
  maxOutput: number;
  modality: FreeTierModality;
  rateLimits: {
    rpm: number;
    rpd: number;
  };
}

export interface RefreshResult {
  provider: FreeTierProvider;
  ok: boolean;
  added: number;
  kept: number;
  removed: number;
  error?: string;
  at: number;
}

// Seed list. Replaced at runtime by `refreshFromOpenRouter()` and augmented
// by the NVIDIA seed below. Verified against the live OpenRouter index on
// 2026-04-23; NVIDIA entries are curated from build.nvidia.com free-credit
// tier. `refreshFromNvidia()` is a v2 concern (their /v1/models endpoint
// doesn't return free/paid classification, so hardcoded is safer today).
const OPENROUTER_SEED: FreeTierModel[] = [
  {
    id: "openrouter/free",
    provider: "openrouter",
    displayName: "OpenRouter Free",
    contextWindow: 200_000,
    maxOutput: 16_000,
    modality: "multimodal",
    rateLimits: { rpm: 20, rpd: 200 },
  },
  {
    id: "nvidia/nemotron-3-super-120b-a12b:free",
    provider: "openrouter",
    displayName: "Nemotron 3 Super 120B",
    contextWindow: 262_000,
    maxOutput: 16_000,
    modality: "text",
    rateLimits: { rpm: 20, rpd: 200 },
  },
  {
    id: "qwen/qwen3-next-80b-a3b-instruct:free",
    provider: "openrouter",
    displayName: "Qwen 3 Next 80B",
    contextWindow: 262_000,
    maxOutput: 16_000,
    modality: "text",
    rateLimits: { rpm: 20, rpd: 200 },
  },
  {
    id: "google/gemma-4-31b-it:free",
    provider: "openrouter",
    displayName: "Gemma 4 31B",
    contextWindow: 262_000,
    maxOutput: 16_000,
    modality: "multimodal",
    rateLimits: { rpm: 20, rpd: 200 },
  },
  {
    id: "minimax/minimax-m2.5:free",
    provider: "openrouter",
    displayName: "MiniMax M2.5",
    contextWindow: 196_000,
    maxOutput: 16_000,
    modality: "text",
    rateLimits: { rpm: 20, rpd: 200 },
  },
  {
    id: "tencent/hy3-preview:free",
    provider: "openrouter",
    displayName: "Tencent Hunyuan 3",
    contextWindow: 262_000,
    maxOutput: 16_000,
    modality: "text",
    rateLimits: { rpm: 20, rpd: 200 },
  },
];

// NVIDIA build.nvidia.com free-credit tier. Rate limits are per-account
// and not published precisely — 40 RPM is a conservative floor. Models
// are curated; NVIDIA's /v1/models exposes 130+ SKUs (including vision
// and embeddings) that don't all belong on a chat roulette.
const NVIDIA_SEED: FreeTierModel[] = [
  {
    id: "meta/llama-3.3-70b-instruct",
    provider: "nvidia",
    displayName: "Llama 3.3 70B",
    contextWindow: 128_000,
    maxOutput: 4_096,
    modality: "text",
    rateLimits: { rpm: 40, rpd: 2000 },
  },
  {
    id: "nvidia/llama-3.3-nemotron-super-49b-v1",
    provider: "nvidia",
    displayName: "Nemotron Super 49B",
    contextWindow: 128_000,
    maxOutput: 4_096,
    modality: "reasoning",
    rateLimits: { rpm: 40, rpd: 2000 },
  },
  {
    id: "deepseek-ai/deepseek-v3.2",
    provider: "nvidia",
    displayName: "DeepSeek V3.2 (NVIDIA)",
    contextWindow: 128_000,
    maxOutput: 4_096,
    modality: "text",
    rateLimits: { rpm: 40, rpd: 2000 },
  },
  {
    id: "meta/llama-4-maverick-17b-128e-instruct",
    provider: "nvidia",
    displayName: "Llama 4 Maverick",
    contextWindow: 1_000_000,
    maxOutput: 4_096,
    modality: "multimodal",
    rateLimits: { rpm: 40, rpd: 2000 },
  },
  {
    id: "qwen/qwen3-235b-a22b",
    provider: "nvidia",
    displayName: "Qwen 3 235B MoE",
    contextWindow: 32_000,
    maxOutput: 4_096,
    modality: "text",
    rateLimits: { rpm: 40, rpd: 2000 },
  },
  {
    id: "nvidia/llama-3.1-nemotron-70b-instruct",
    provider: "nvidia",
    displayName: "Nemotron 70B",
    contextWindow: 128_000,
    maxOutput: 4_096,
    modality: "text",
    rateLimits: { rpm: 40, rpd: 2000 },
  },
];

// Live mutable catalog. `refreshFromOpenRouter()` replaces the OpenRouter
// slice; NVIDIA stays put. Consumers read via `getCatalog()` so the same
// array identity is preserved — don't expose the inner array directly.
let catalog: FreeTierModel[] = [...NVIDIA_SEED, ...OPENROUTER_SEED];
let catalogAugmented = false;

export function getCatalog(): ReadonlyArray<FreeTierModel> {
  ensureAugmented();
  return catalog;
}

// Chat-usable modalities on the roulette. Embeddings, rerankers, image/video
// gen, ocr, bio, etc. are curated into data/*-catalog.json but explicitly
// excluded here — the roulette is for user-facing chat/reasoning only.
const ROULETTE_MODALITIES = new Set(["text", "vision", "multimodal"]);

interface CatalogFileModel {
  id: string;
  publisher: string;
  display_name: string;
  modality: string[];
  context_window: number | null;
  max_output: number | null;
  pricing: unknown;
  rate_limits: { rpm: number | null; rpd: number | null } | null;
  tags: string[];
  notes?: { curated?: string | null };
}
interface CatalogFile {
  provider: "nvidia" | "openrouter";
  defaults: {
    rate_limits: { rpm: number | null; rpd: number | null } | null;
    pricing: unknown;
  };
  models: CatalogFileModel[];
}

function readCatalogFile(relPath: string): CatalogFile | null {
  // Sync read is fine: runs once per router instance on first pick().
  // `require("fs")` inside the function avoids bundling fs into client
  // builds that transitively import this module for types only.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs") as typeof import("fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("path") as typeof import("path");
    const full = path.join(process.cwd(), relPath);
    if (!fs.existsSync(full)) return null;
    return JSON.parse(fs.readFileSync(full, "utf8")) as CatalogFile;
  } catch {
    return null;
  }
}

function toFreeTierModel(
  m: CatalogFileModel,
  provider: FreeTierProvider,
  defaultRateLimits: { rpm: number; rpd: number },
  defaultMaxOutput: number,
): FreeTierModel | null {
  if (!m.modality.some((x) => ROULETTE_MODALITIES.has(x))) return null;
  // heuristic: "reasoning" is inferred from curated notes / tags rather
  // than modality, since modality is an input-shape concept.
  const curated = (m.notes?.curated ?? "").toLowerCase();
  const isReasoning =
    m.tags.some((t) => t === "reasoning") ||
    /\breasoning\b|chain[- ]of[- ]thought|thinking model/.test(curated);
  const hasVision = m.modality.includes("vision") || m.modality.includes("multimodal");
  const modality: FreeTierModality = isReasoning
    ? "reasoning"
    : hasVision
      ? "multimodal"
      : "text";
  return {
    id: m.id,
    provider,
    displayName: m.display_name || prettyName(m.id),
    contextWindow: m.context_window ?? 128_000,
    maxOutput: m.max_output ?? defaultMaxOutput,
    modality,
    rateLimits: {
      rpm: m.rate_limits?.rpm ?? defaultRateLimits.rpm,
      rpd: m.rate_limits?.rpd ?? defaultRateLimits.rpd,
    },
  };
}

/**
 * Augment the seed catalog with chat-usable free-tier models from
 * data/*-catalog.json. Seeds stay at the head of the list so the
 * roulette's curated preference order is preserved; catalog-derived
 * entries fill in behind them.
 *
 * Idempotent: flipping `catalogAugmented` makes subsequent calls a no-op.
 * Safe to call on every public entry point.
 */
function ensureAugmented(): void {
  if (catalogAugmented) return;
  catalogAugmented = true;
  const existing = new Set(catalog.map((m) => m.id));

  const nvidiaFile = readCatalogFile("data/nvidia-catalog.json");
  if (nvidiaFile) {
    for (const m of nvidiaFile.models) {
      if (existing.has(m.id)) continue;
      const mapped = toFreeTierModel(m, "nvidia", { rpm: 40, rpd: 1000 }, 4096);
      if (!mapped) continue;
      catalog.push(mapped);
      existing.add(m.id);
    }
  }

  const orFile = readCatalogFile("data/openrouter-catalog.json");
  if (orFile) {
    for (const m of orFile.models) {
      if (existing.has(m.id)) continue;
      // Only free-tier on OR — paid models go through a different path.
      if (!m.tags.includes("free")) continue;
      const mapped = toFreeTierModel(m, "openrouter", { rpm: 20, rpd: 200 }, 16_000);
      if (!mapped) continue;
      catalog.push(mapped);
      existing.add(m.id);
    }
  }
}

interface OpenRouterModel {
  id: string;
  name?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  architecture?: { modality?: string };
}

function mapModality(m: string | undefined): FreeTierModality {
  if (!m) return "text";
  if (m.includes("video") || m.includes("image")) return "multimodal";
  return "text";
}

function prettyName(id: string): string {
  const stem = id.replace(/:free$/, "").split("/").pop() ?? id;
  return stem
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

export async function refreshFromOpenRouter(): Promise<RefreshResult> {
  const at = Date.now();
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { data?: OpenRouterModel[] };
    const live = (data.data ?? []).filter(
      (m) =>
        m.pricing?.prompt === "0" &&
        m.pricing?.completion === "0" &&
        !m.id.includes("embed") &&
        // Skip audio-first and image-gen models — chat-only roulette.
        !(m.architecture?.modality ?? "").includes("audio"),
    );
    const fresh: FreeTierModel[] = live.map((m) => ({
      id: m.id,
      provider: "openrouter",
      displayName: prettyName(m.id),
      contextWindow: m.context_length ?? 131_072,
      maxOutput: 16_000,
      modality: mapModality(m.architecture?.modality),
      rateLimits: { rpm: 20, rpd: 200 },
    }));
    const kept = catalog.filter((m) => m.provider !== "openrouter");
    const removed = catalog.length - kept.length;
    catalog = [...kept, ...fresh];
    return { provider: "openrouter", ok: true, added: fresh.length, kept: kept.length, removed, at };
  } catch (e) {
    return {
      provider: "openrouter",
      ok: false,
      added: 0,
      kept: catalog.filter((m) => m.provider === "openrouter").length,
      removed: 0,
      error: e instanceof Error ? e.message : "unknown",
      at,
    };
  }
}

interface Counter {
  minuteStart: number;
  minuteCount: number;
  dayStart: number;
  dayCount: number;
  lockedUntilMinute?: number;
  lockedUntilDay?: number;
}

export type ExhaustionReason = "429-minute" | "429-day" | "rpm" | "rpd";

export interface PickOptions {
  needsMultimodal?: boolean;
  minContextWindow?: number;
  excludeReasoning?: boolean;
  /** IDs to skip for this pick only (e.g. models whose API key is missing). */
  excludeIds?: ReadonlySet<string>;
  /**
   * Try this model first. If present in the catalog, not excluded, and
   * available (not rate-limited), returns it. Otherwise falls through to
   * the normal roulette walk. Used when the user has a remembered
   * preference but we don't want to fail the request if that model is
   * currently locked.
   */
  preferredId?: string;
}

export interface Pick {
  model: FreeTierModel;
  switched: boolean;
  previous?: string;
  reason?: ExhaustionReason;
}

export interface StatusEntry {
  model: FreeTierModel;
  remainingRpm: number;
  remainingRpd: number;
  locked: boolean;
  lockReason?: ExhaustionReason;
}

const REFRESH_TTL_MS = 6 * 60 * 60 * 1000; // 6h

class FreeTierRouter {
  private counters = new Map<string, Counter>();
  private lastPick: string | undefined;
  private lastRefreshAt: number = 0;
  private refreshPromise: Promise<RefreshResult> | null = null;
  lastRefreshResult: RefreshResult | null = null;

  /**
   * Lazy refresh: if the catalog hasn't been refreshed in REFRESH_TTL_MS,
   * kick one off but don't block the caller. Next call sees fresh data.
   */
  maybeRefresh(): void {
    const now = Date.now();
    if (now - this.lastRefreshAt < REFRESH_TTL_MS) return;
    if (this.refreshPromise) return;
    this.refreshPromise = refreshFromOpenRouter()
      .then((r) => {
        this.lastRefreshResult = r;
        if (r.ok) this.lastRefreshAt = r.at;
        return r;
      })
      .finally(() => {
        this.refreshPromise = null;
      });
  }

  async forceRefresh(): Promise<RefreshResult> {
    if (this.refreshPromise) return this.refreshPromise;
    const p = refreshFromOpenRouter().then((r) => {
      this.lastRefreshResult = r;
      if (r.ok) this.lastRefreshAt = r.at;
      return r;
    });
    this.refreshPromise = p;
    try {
      return await p;
    } finally {
      this.refreshPromise = null;
    }
  }

  getLastRefresh(): { at: number; result: RefreshResult | null } {
    return { at: this.lastRefreshAt, result: this.lastRefreshResult };
  }

  private getCounter(id: string): Counter {
    let c = this.counters.get(id);
    const now = Date.now();
    const dayStart = new Date(now).setUTCHours(0, 0, 0, 0);
    if (!c) {
      c = { minuteStart: now, minuteCount: 0, dayStart, dayCount: 0 };
      this.counters.set(id, c);
      return c;
    }
    if (now - c.minuteStart >= 60_000) {
      c.minuteStart = now;
      c.minuteCount = 0;
      c.lockedUntilMinute = undefined;
    }
    if (dayStart !== c.dayStart) {
      c.dayStart = dayStart;
      c.dayCount = 0;
      c.lockedUntilDay = undefined;
    }
    return c;
  }

  private isAvailable(model: FreeTierModel): { ok: boolean; reason?: ExhaustionReason } {
    const c = this.getCounter(model.id);
    const now = Date.now();
    if (c.lockedUntilDay && c.lockedUntilDay > now) return { ok: false, reason: "429-day" };
    if (c.lockedUntilMinute && c.lockedUntilMinute > now) return { ok: false, reason: "429-minute" };
    if (c.dayCount >= model.rateLimits.rpd) return { ok: false, reason: "rpd" };
    if (c.minuteCount >= model.rateLimits.rpm) return { ok: false, reason: "rpm" };
    return { ok: true };
  }

  pick(options: PickOptions = {}): Pick | null {
    ensureAugmented();
    const candidates = catalog.filter((m) => {
      if (options.excludeIds?.has(m.id)) return false;
      if (options.needsMultimodal && m.modality !== "multimodal" && m.modality !== "vision") return false;
      if (options.minContextWindow && m.contextWindow < options.minContextWindow) return false;
      if (options.excludeReasoning && m.modality === "reasoning") return false;
      return true;
    });

    // Preferred-id short-circuit: if the user has a remembered model and
    // it's in the candidate set AND available, use it. Otherwise fall
    // through so rate-limited preferences degrade into the normal
    // roulette rather than failing the whole request.
    if (options.preferredId) {
      const preferred = candidates.find((m) => m.id === options.preferredId);
      if (preferred && this.isAvailable(preferred).ok) {
        const switched = this.lastPick !== undefined && this.lastPick !== preferred.id;
        const previous = switched ? this.lastPick : undefined;
        this.lastPick = preferred.id;
        return { model: preferred, switched, previous };
      }
    }

    let reason: ExhaustionReason | undefined;
    for (const m of candidates) {
      const avail = this.isAvailable(m);
      if (avail.ok) {
        const switched = this.lastPick !== undefined && this.lastPick !== m.id;
        const previous = switched ? this.lastPick : undefined;
        this.lastPick = m.id;
        return { model: m, switched, previous, reason: switched ? reason : undefined };
      }
      if (!reason) reason = avail.reason;
    }
    return null;
  }

  record(id: string): void {
    const model = catalog.find((m) => m.id === id);
    if (!model) return;
    const c = this.getCounter(id);
    c.minuteCount += 1;
    c.dayCount += 1;
  }

  markExhausted(id: string, reason: ExhaustionReason): void {
    const c = this.getCounter(id);
    const now = Date.now();
    if (reason === "429-day" || reason === "rpd") {
      const tomorrow = new Date(now);
      tomorrow.setUTCHours(24, 0, 0, 0);
      c.lockedUntilDay = tomorrow.getTime();
    } else {
      c.lockedUntilMinute = c.minuteStart + 60_000;
    }
  }

  status(): StatusEntry[] {
    ensureAugmented();
    return catalog.map((model) => {
      const c = this.getCounter(model.id);
      const avail = this.isAvailable(model);
      return {
        model,
        remainingRpm: Math.max(0, model.rateLimits.rpm - c.minuteCount),
        remainingRpd: Math.max(0, model.rateLimits.rpd - c.dayCount),
        locked: !avail.ok,
        lockReason: avail.reason,
      };
    });
  }

  currentPick(): string | undefined {
    return this.lastPick;
  }
}

// Singleton cached on globalThis so it survives Next dev's per-route
// module caching — otherwise /api/chat/free and /api/free-tier/status
// would each see their own counter instance and the UI would never
// reflect real usage.
//
// The cache key carries a version suffix: bump it whenever the class
// shape changes (new methods, renamed fields) so dev reloads pick up the
// new instance instead of returning a stale one that's missing methods.
const ROUTER_VERSION = 4;
const globalAny = globalThis as unknown as { [k: string]: FreeTierRouter | undefined };
const key = `__deckFreeTierRouter_v${ROUTER_VERSION}`;
export const freeTierRouter: FreeTierRouter =
  globalAny[key] ?? (globalAny[key] = new FreeTierRouter());
