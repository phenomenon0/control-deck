import { describe, expect, test } from "bun:test";

import { attachProcessMemory, summariseLlamaCppSlots } from "./kv-cache";

describe("kv cache telemetry", () => {
  test("summarises llama.cpp slot context", () => {
    const snap = summariseLlamaCppSlots(
      "qwen3.5-9b",
      "http://127.0.0.1:10002",
      "ready",
      {
        total_slots: 2,
        default_generation_settings: { n_ctx: 4096 },
        endpoint_metrics: false,
      },
      [
        { id: 0, n_ctx: 4096, is_processing: false },
        { id: 1, n_ctx: 2048, is_processing: true, next_token: [{ n_decoded: 12, n_remain: 3 }] },
      ],
      false,
    );

    expect(snap.modelId).toBe("qwen3.5-9b");
    expect(snap.slotCount).toBe(2);
    expect(snap.activeSlots).toBe(1);
    expect(snap.slotContextTokens).toBe(4096);
    expect(snap.logicalContextTokens).toBe(6144);
    expect(snap.decodedTokens).toBe(12);
    expect(snap.metricsEnabled).toBe(false);
  });

  test("uses props when slot details are unavailable", () => {
    const snap = summariseLlamaCppSlots(
      "qwen3.5-35b",
      "http://127.0.0.1:10001",
      "loading",
      {
        total_slots: 4,
        default_generation_settings: { n_ctx: 8192 },
        endpoint_metrics: true,
      },
      [],
      false,
    );

    expect(snap.slotCount).toBe(4);
    expect(snap.slotContextTokens).toBe(8192);
    expect(snap.logicalContextTokens).toBe(32768);
    expect(snap.metricsEnabled).toBe(true);
  });

  test("attaches process memory only when one cache row is present", () => {
    const one = summariseLlamaCppSlots("qwen3.5-9b", "http://127.0.0.1:10002", "ready", null, [], false);
    expect(attachProcessMemory([one], 9800)[0].processUsedMemoryMb).toBe(9800);

    const first = summariseLlamaCppSlots("a", "http://127.0.0.1:10001", "ready", null, [], false);
    const second = summariseLlamaCppSlots("b", "http://127.0.0.1:10002", "ready", null, [], false);
    const many = attachProcessMemory([first, second], 9800);
    expect(many[0].processUsedMemoryMb).toBeUndefined();
    expect(many[1].processUsedMemoryMb).toBeUndefined();
  });
});
