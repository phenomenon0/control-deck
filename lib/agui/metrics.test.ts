/**
 * Engine-latency tests — synthetic event sequences → expected TTFT /
 * tool round-trip / resolveMs / p50 / p95.
 *
 * The SQL window runs against a bun:sqlite in-memory database with a minimal
 * runs+events schema: better-sqlite3 cannot load under bun, and DECK_DB_PATH
 * is unreliable in this suite (lib/agui/db/connection resolves its path at
 * first module evaluation — whichever test file loads first wins, see
 * app/api/threads/route.test.ts). engineLatencyWithDb takes the db handle, so
 * no module state is involved.
 */

import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  aggregateEngineLatency,
  distributionOf,
  engineLatencyWithDb,
  extractRunLatency,
  type MetricsDb,
  type RunAnchors,
  type RunLatency,
  type TimingEventRow,
} from "./metrics";

/* ── pure extraction ─────────────────────────────────────────────────────── */

function anchors(
  runId: string,
  startedAt: string | null,
  firstContentAt: string | null,
): RunAnchors {
  return { runId, startedAt, firstContentAt };
}

function row(type: string, timestamp: string, data?: unknown): TimingEventRow {
  return { type, timestamp, data };
}

const T0 = "2026-07-18T00:00:00.000Z";
const plus = (ms: number) => new Date(Date.parse(T0) + ms).toISOString();

describe("extractRunLatency", () => {
  test("full run: TTFT, both round-trip flavors, resolveMs, provider", () => {
    const r = extractRunLatency(anchors("r1", T0, plus(800)), [
      row("LLMResolved", plus(100), {
        resolveMs: 12,
        provider: "llamacpp",
        modelId: "q4_k",
      }),
      row("ToolCallStart", plus(1000), { toolCallId: "a" }),
      row("ToolCallResult", plus(1600), { toolCallId: "a" }), // 600 via timestamp delta
      row("ToolCallResult", plus(2000), { toolCallId: "b", durationMs: 45 }), // durationMs, no start needed
    ]);
    expect(r.ttftMs).toBe(800);
    expect(r.toolRoundTripsMs).toEqual([600, 45]);
    expect(r.resolveMs).toBe(12);
    expect(r.provider).toBe("llamacpp");
    expect(r.modelId).toBe("q4_k");
  });

  test("missing RunStarted anchor → no TTFT", () => {
    const r = extractRunLatency(anchors("r1", null, plus(800)), []);
    expect(r.ttftMs).toBeNull();
  });

  test("missing first content → no TTFT", () => {
    const r = extractRunLatency(anchors("r1", T0, null), []);
    expect(r.ttftMs).toBeNull();
  });

  test("clock skew: negative deltas are dropped, not clamped", () => {
    const r = extractRunLatency(anchors("r1", T0, plus(-50)), [
      row("ToolCallStart", plus(1000), { toolCallId: "a" }),
      row("ToolCallResult", plus(900), { toolCallId: "a" }),
    ]);
    expect(r.ttftMs).toBeNull();
    expect(r.toolRoundTripsMs).toEqual([]);
  });

  test("ToolCallResult without durationMs or a matching start yields no sample", () => {
    const r = extractRunLatency(anchors("r1", T0, null), [
      row("ToolCallResult", plus(500), { toolCallId: "orphan" }),
    ]);
    expect(r.toolRoundTripsMs).toEqual([]);
  });

  test("durationMs wins over the timestamp delta", () => {
    const r = extractRunLatency(anchors("r1", T0, null), [
      row("ToolCallStart", plus(1000), { toolCallId: "a" }),
      row("ToolCallResult", plus(5000), { toolCallId: "a", durationMs: 30 }),
    ]);
    expect(r.toolRoundTripsMs).toEqual([30]);
  });

  test("a toolCallId can be re-measured after its result lands", () => {
    const r = extractRunLatency(anchors("r1", T0, null), [
      row("ToolCallStart", plus(0), { toolCallId: "a" }),
      row("ToolCallResult", plus(100), { toolCallId: "a" }),
      row("ToolCallStart", plus(200), { toolCallId: "a" }),
      row("ToolCallResult", plus(350), { toolCallId: "a" }),
    ]);
    expect(r.toolRoundTripsMs).toEqual([100, 150]);
  });

  test("LLMResolved without resolveMs still attributes the provider", () => {
    const r = extractRunLatency(anchors("r1", T0, null), [
      row("LLMResolved", plus(50), { provider: "anthropic", modelId: "sonnet" }),
    ]);
    expect(r.resolveMs).toBeNull();
    expect(r.provider).toBe("anthropic");
  });

  test("unparseable / missing data payloads are tolerated", () => {
    const r = extractRunLatency(anchors("r1", T0, plus(10)), [
      row("ToolCallStart", plus(100)), // no data at all
      row("ToolCallResult", plus(200), undefined),
      row("LLMResolved", plus(50), "not an object"),
    ]);
    expect(r.ttftMs).toBe(10);
    expect(r.toolRoundTripsMs).toEqual([]);
    expect(r.resolveMs).toBeNull();
  });
});

/* ── pure aggregation ────────────────────────────────────────────────────── */

describe("distributionOf", () => {
  test("empty input → zeroed stats", () => {
    expect(distributionOf([])).toEqual({ count: 0, p50: 0, p95: 0, avg: 0 });
  });

  test("known distribution", () => {
    // quantile picks sorted[floor(q * (n-1))] → p50 = 200, p95 = 300
    expect(distributionOf([400, 100, 300, 200])).toEqual({
      count: 4,
      p50: 200,
      p95: 300,
      avg: 250,
    });
  });
});

function runLatency(partial: Partial<RunLatency> & { runId: string }): RunLatency {
  return {
    ttftMs: null,
    toolRoundTripsMs: [],
    resolveMs: null,
    provider: null,
    modelId: null,
    ...partial,
  };
}

describe("aggregateEngineLatency", () => {
  test("windowed percentiles, timed count, provider grouping", () => {
    const runs = [
      runLatency({ runId: "r1", ttftMs: 500, toolRoundTripsMs: [100, 300], resolveMs: 10, provider: "llamacpp" }),
      runLatency({ runId: "r2", ttftMs: 1500, toolRoundTripsMs: [200], resolveMs: 20, provider: "anthropic" }),
      runLatency({ runId: "r3", ttftMs: 2500, provider: "llamacpp" }), // no resolve signal
      runLatency({ runId: "r4" }), // untimed
    ];
    const agg = aggregateEngineLatency(runs, 200, 4);

    expect(agg.runsSampled).toBe(4);
    expect(agg.runsTimed).toBe(3);
    // ttft [500,1500,2500]: floor(0.5*2)=1 → 1500, floor(0.95*2)=1 → 1500
    expect(agg.ttft).toEqual({ count: 3, p50: 1500, p95: 1500, avg: 1500 });
    // round-trips [100,300,200] → sorted [100,200,300]
    expect(agg.toolRoundTrip).toEqual({ count: 3, p50: 200, p95: 200, avg: 200 });
    // resolve [10,20]: floor(0.5*1)=0 → 10, floor(0.95*1)=0 → 10
    expect(agg.resolve).toEqual({ count: 2, p50: 10, p95: 10, avg: 15 });

    expect(agg.providers.map((p) => p.provider)).toEqual(["llamacpp", "anthropic"]);
    const llama = agg.providers[0];
    expect(llama.runs).toBe(2);
    expect(llama.ttft).toEqual({ count: 2, p50: 500, p95: 500, avg: 1500 });
    expect(llama.toolRoundTrip).toEqual({ count: 2, p50: 100, p95: 100, avg: 200 });
    expect(llama.resolve.count).toBe(1); // r3 carried no resolveMs
  });

  test("no runs → zeroed everything", () => {
    const agg = aggregateEngineLatency([], 200, 0);
    expect(agg.runsSampled).toBe(0);
    expect(agg.runsTimed).toBe(0);
    expect(agg.ttft.count).toBe(0);
    expect(agg.providers).toEqual([]);
  });
});

/* ── SQL window, end to end ──────────────────────────────────────────────── */

function makeDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running'
    );
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      type TEXT NOT NULL,
      schema_version INTEGER NOT NULL DEFAULT 2,
      data TEXT NOT NULL,
      timestamp TEXT NOT NULL
    );
  `);
  return db;
}

function insertRun(db: Database, id: string, startedAt: string) {
  db.prepare(`INSERT INTO runs (id, thread_id, started_at, status) VALUES (?, 't', ?, 'finished')`).run(
    id,
    startedAt,
  );
}

function insertEvent(db: Database, runId: string, type: string, timestamp: string, data: unknown) {
  db.prepare(
    `INSERT INTO events (run_id, thread_id, type, data, timestamp) VALUES (?, 't', ?, ?, ?)`,
  ).run(runId, type, JSON.stringify(data ?? {}), timestamp);
}

/** Three runs, oldest first: r1 (ttft 500), r2 (ttft 1500), r3 (ttft 2500). */
function seedThreeRuns(db: Database) {
  const base = Date.parse("2026-07-18T00:00:00.000Z");
  const specs = [
    { id: "r1", offset: 0, ttft: 500, roundTrip: 100, resolveMs: 10, provider: "llamacpp" },
    { id: "r2", offset: 60_000, ttft: 1500, roundTrip: 200, resolveMs: 20, provider: "anthropic" },
    { id: "r3", offset: 120_000, ttft: 2500, roundTrip: 300, resolveMs: null, provider: "llamacpp" },
  ] as const;
  for (const s of specs) {
    const t0 = new Date(base + s.offset).toISOString();
    insertRun(db, s.id, t0);
    insertEvent(db, s.id, "RunStarted", t0, { type: "RunStarted", runId: s.id });
    insertEvent(db, s.id, "LLMResolved", new Date(base + s.offset + 50).toISOString(), {
      type: "LLMResolved",
      runId: s.id,
      provider: s.provider,
      modelId: "m",
      ...(s.resolveMs === null ? {} : { resolveMs: s.resolveMs }),
    });
    insertEvent(db, s.id, "ToolCallStart", new Date(base + s.offset + 400).toISOString(), {
      type: "ToolCallStart",
      runId: s.id,
      toolCallId: "tc",
      toolName: "bash",
    });
    insertEvent(db, s.id, "ToolCallResult", new Date(base + s.offset + 400 + s.roundTrip).toISOString(), {
      type: "ToolCallResult",
      runId: s.id,
      toolCallId: "tc",
      result: { kind: "json", data: "ok" },
    });
    insertEvent(db, s.id, "TextMessageContent", new Date(base + s.offset + s.ttft).toISOString(), {
      type: "TextMessageContent",
      runId: s.id,
      messageId: "msg",
      delta: "hello",
    });
  }
}

describe("engineLatencyWithDb", () => {
  test("aggregates the run window end to end", () => {
    const db = makeDb();
    seedThreeRuns(db);
    const agg = engineLatencyWithDb(db as unknown as MetricsDb, 200);

    expect(agg.limit).toBe(200);
    expect(agg.runsSampled).toBe(3);
    expect(agg.runsTimed).toBe(3);
    expect(agg.ttft).toEqual({ count: 3, p50: 1500, p95: 1500, avg: 1500 });
    expect(agg.toolRoundTrip).toEqual({ count: 3, p50: 200, p95: 200, avg: 200 });
    expect(agg.resolve).toEqual({ count: 2, p50: 10, p95: 10, avg: 15 });
    expect(agg.providers.map((p) => `${p.provider}:${p.runs}`)).toEqual([
      "llamacpp:2",
      "anthropic:1",
    ]);
    db.close();
  });

  test("limit bounds the window to the newest runs", () => {
    const db = makeDb();
    seedThreeRuns(db);
    const agg = engineLatencyWithDb(db as unknown as MetricsDb, 2);

    expect(agg.limit).toBe(2);
    expect(agg.runsSampled).toBe(2);
    // r1 fell out of the window: only r3 (2500) and r2 (1500) remain
    expect(agg.ttft).toEqual({ count: 2, p50: 1500, p95: 1500, avg: 2000 });
    expect(agg.resolve.count).toBe(1); // r3 had no resolveMs, r1 is out
    db.close();
  });

  test("runs with no events count as sampled but not timed", () => {
    const db = makeDb();
    insertRun(db, "empty", "2026-07-18T00:00:00.000Z");
    const agg = engineLatencyWithDb(db as unknown as MetricsDb, 200);
    expect(agg.runsSampled).toBe(1);
    expect(agg.runsTimed).toBe(0);
    expect(agg.ttft.count).toBe(0);
    db.close();
  });

  test("empty ledger → zeroed aggregate", () => {
    const db = makeDb();
    const agg = engineLatencyWithDb(db as unknown as MetricsDb, 200);
    expect(agg.runsSampled).toBe(0);
    expect(agg.ttft.count).toBe(0);
    expect(agg.providers).toEqual([]);
    db.close();
  });

  test("invalid limits fall back to the default window size", () => {
    const db = makeDb();
    seedThreeRuns(db);
    expect(engineLatencyWithDb(db as unknown as MetricsDb, Number.NaN).limit).toBe(200);
    expect(engineLatencyWithDb(db as unknown as MetricsDb, 0).limit).toBe(200);
    db.close();
  });
});
