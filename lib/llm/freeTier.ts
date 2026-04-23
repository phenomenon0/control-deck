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

export type FreeTierProvider = "openrouter";
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

// Verified against https://openrouter.ai/api/v1/models on 2026-04-23.
// All IDs carry `pricing.prompt === 0 && pricing.completion === 0`. The
// "hunt for free stuff" loop replaces this list at runtime in v2; for v1
// the catalog is refreshed manually when models roll over.
export const FREE_TIER_CATALOG: FreeTierModel[] = [
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

class FreeTierRouter {
  private counters = new Map<string, Counter>();
  private lastPick: string | undefined;

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
    const candidates = FREE_TIER_CATALOG.filter((m) => {
      if (options.needsMultimodal && m.modality !== "multimodal" && m.modality !== "vision") return false;
      if (options.minContextWindow && m.contextWindow < options.minContextWindow) return false;
      if (options.excludeReasoning && m.modality === "reasoning") return false;
      return true;
    });

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
    const model = FREE_TIER_CATALOG.find((m) => m.id === id);
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
    return FREE_TIER_CATALOG.map((model) => {
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
const globalAny = globalThis as { __deckFreeTierRouter?: FreeTierRouter };
export const freeTierRouter: FreeTierRouter =
  globalAny.__deckFreeTierRouter ?? (globalAny.__deckFreeTierRouter = new FreeTierRouter());
