import { describe, expect, test } from "bun:test";

import { aggregateReports, createProbe, JUNCTIONS, type ProbeReport } from "./latency-probe";

describe("createProbe", () => {
  test("collects marks in order", async () => {
    const probe = createProbe();
    probe.mark(JUNCTIONS.CHUNK_FIRST);
    await sleep(10);
    probe.mark(JUNCTIONS.STT_PARTIAL_FIRST, { text: "he" });
    const r = probe.report();
    expect(r.marks.length).toBe(2);
    expect(r.marks[0].name).toBe(JUNCTIONS.CHUNK_FIRST);
    expect(r.marks[1].meta).toEqual({ text: "he" });
    expect(r.marks[1].t).toBeGreaterThan(r.marks[0].t);
  });

  test("computes standard spans when both endpoints fire", async () => {
    const probe = createProbe();
    probe.mark(JUNCTIONS.CHUNK_FIRST);
    await sleep(20);
    probe.mark(JUNCTIONS.STT_PARTIAL_FIRST);
    await sleep(15);
    probe.mark(JUNCTIONS.STT_FINAL);
    const r = probe.report();
    expect(r.spans.stt_ttft).toBeGreaterThanOrEqual(15);
    expect(r.spans.stt_final_after_first_chunk).toBeGreaterThanOrEqual(30);
  });

  test("missing marks → span absent, no throw", () => {
    const probe = createProbe();
    probe.mark(JUNCTIONS.CHUNK_FIRST);
    const r = probe.report();
    expect(r.spans.stt_ttft).toBeUndefined();
    expect(r.spans.ws_open_cost).toBeUndefined();
  });

  test("first occurrence wins for repeated marks", async () => {
    const probe = createProbe();
    probe.mark(JUNCTIONS.CHUNK_FIRST);
    await sleep(5);
    probe.mark(JUNCTIONS.STT_PARTIAL_FIRST);
    await sleep(5);
    probe.mark(JUNCTIONS.STT_PARTIAL_FIRST); // duplicate; should be ignored for span calc
    const r = probe.report();
    const partials = r.marks.filter((m) => m.name === JUNCTIONS.STT_PARTIAL_FIRST);
    expect(partials.length).toBe(2);
    expect(r.spans.stt_ttft).toBeLessThan(15);
  });

  test("reset clears marks", () => {
    const probe = createProbe();
    probe.mark(JUNCTIONS.CHUNK_FIRST);
    probe.reset();
    expect(probe.marks().length).toBe(0);
  });
});

describe("aggregateReports", () => {
  test("computes p50/p95/mean across runs", () => {
    const reports = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((v) => ({
      startedAt: 0,
      marks: [],
      deltas: {},
      spans: { stt_ttft: v },
    }));
    const agg = aggregateReports(reports);
    expect(agg.count).toBe(10);
    expect(agg.byKey.stt_ttft.count).toBe(10);
    expect(agg.byKey.stt_ttft.min).toBe(10);
    expect(agg.byKey.stt_ttft.max).toBe(100);
    expect(agg.byKey.stt_ttft.mean).toBe(55);
    // floor(10 * 0.5) = 5 → values[5] = 60
    expect(agg.byKey.stt_ttft.p50).toBe(60);
    expect(agg.byKey.stt_ttft.p95).toBe(100);
  });

  test("ignores missing keys per run", () => {
    const reports: ProbeReport[] = [
      { startedAt: 0, marks: [], deltas: {}, spans: { stt_ttft: 100 } },
      { startedAt: 0, marks: [], deltas: {}, spans: {} },
      { startedAt: 0, marks: [], deltas: {}, spans: { stt_ttft: 200 } },
    ];
    const agg = aggregateReports(reports);
    expect(agg.byKey.stt_ttft.count).toBe(2);
    expect(agg.byKey.stt_ttft.mean).toBe(150);
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
