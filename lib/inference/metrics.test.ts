/**
 * Metrics: withMetrics records success + failure, snapshot builds correct
 * per-bucket summaries with p50 / p95 / error rate.
 */

import { describe, test, expect, beforeEach } from "bun:test";

import { withMetrics, getMetricsSnapshot, __resetMetrics } from "./metrics";

describe("metrics", () => {
  beforeEach(() => __resetMetrics());

  test("successful invocations increment the ok counter", async () => {
    await withMetrics("tts", "elevenlabs", async () => "ok");
    const snap = getMetricsSnapshot();
    expect(snap.counters["tts::elevenlabs::ok"]).toBe(1);
    expect(snap.counters["tts::ok"]).toBe(1);
    expect(snap.summary[0]?.count).toBe(1);
    expect(snap.summary[0]?.errorCount).toBe(0);
  });

  test("failing invocations increment error counter and rethrow", async () => {
    await expect(
      withMetrics("stt", "groq", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const snap = getMetricsSnapshot();
    expect(snap.counters["stt::groq::error"]).toBe(1);
    expect(snap.summary[0]?.errorCount).toBe(1);
    expect(snap.summary[0]?.errorRate).toBe(1);
  });

  test("summary aggregates per (modality, provider) bucket", async () => {
    await withMetrics("tts", "elevenlabs", async () => "a");
    await withMetrics("tts", "elevenlabs", async () => "b");
    await withMetrics("tts", "openai", async () => "c");
    const snap = getMetricsSnapshot();
    const eleven = snap.summary.find((s) => s.providerId === "elevenlabs");
    const openai = snap.summary.find((s) => s.providerId === "openai");
    expect(eleven?.count).toBe(2);
    expect(openai?.count).toBe(1);
  });

  test("ring buffer cap at 500 (smoke test)", async () => {
    for (let i = 0; i < 600; i += 1) {
      await withMetrics("text", "openai", async () => i);
    }
    const snap = getMetricsSnapshot();
    expect(snap.recent.length).toBe(500);
  });
});
