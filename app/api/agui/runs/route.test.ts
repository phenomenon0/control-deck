/**
 * Runs route tests — engine-latency aggregate wiring. Follows the threads
 * route-test pattern: spies on the real metrics module so the handler runs
 * end-to-end without touching SQLite (better-sqlite3 cannot load under bun,
 * and DECK_DB_PATH is unreliable across same-process test files).
 */

import { afterAll, describe, expect, mock, spyOn, test } from "bun:test";
import * as actualMetrics from "@/lib/agui/metrics";

const engineLatencySpy = spyOn(actualMetrics, "engineLatency").mockImplementation(
  ((limit?: number) => ({
    limit: limit ?? 200,
    runsSampled: 3,
    runsTimed: 2,
    ttft: { count: 2, p50: 500, p95: 1500, avg: 1000 },
    toolRoundTrip: { count: 1, p50: 200, p95: 200, avg: 200 },
    resolve: { count: 0, p50: 0, p95: 0, avg: 0 },
    providers: [],
  })) as never,
);

const { GET } = await import("./route");

afterAll(() => {
  // Revert the spies so later test files see real module behaviour.
  mock.restore();
});

function reqGet(qs = "") {
  return new Request(`http://localhost/api/agui/runs${qs ? `?${qs}` : ""}`);
}

describe("GET /api/agui/runs?aggregate=engine", () => {
  test("returns the engine latency aggregate", async () => {
    const res = await GET(reqGet("aggregate=engine"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      limit: number;
      runsTimed: number;
      ttft: { p50: number };
    };
    expect(body.ttft.p50).toBe(500);
    expect(body.runsTimed).toBe(2);
  });

  test("passes the requested run limit through", async () => {
    engineLatencySpy.mockClear();
    await GET(reqGet("aggregate=engine&limit=50"));
    expect(engineLatencySpy).toHaveBeenCalledWith(50);
  });

  test("defaults to a 200-run window", async () => {
    engineLatencySpy.mockClear();
    await GET(reqGet("aggregate=engine"));
    expect(engineLatencySpy).toHaveBeenCalledWith(200);
  });

  test("unknown aggregate still 400s", async () => {
    const res = await GET(reqGet("aggregate=bogus"));
    expect(res.status).toBe(400);
  });
});
