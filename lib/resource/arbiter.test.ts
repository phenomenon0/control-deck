import { afterEach, describe, expect, test } from "bun:test";

import { __test as arbiterTest, acquire, release, reportOom, listReservations } from "./arbiter";
import { __test as ledgerTest } from "./ledger";
import type { GpuMemory } from "./ledger";

const TOTAL = 24576;

function setFree(freeMb: number) {
  const mem: GpuMemory = {
    totalMb: TOTAL,
    usedMb: TOTAL - freeMb,
    freeMb,
    source: "nvidia-smi",
  };
  ledgerTest.setMemoryOverride(async () => mem);
}

function setReserve(mb: number) {
  ledgerTest.setReserveOverride(mb);
}

afterEach(() => {
  arbiterTest.reset();
  ledgerTest.reset();
});

describe("arbiter.acquire — fast path", () => {
  test("grants when free VRAM covers estimate + reserve", async () => {
    setFree(20_000);
    setReserve(2048);
    const r = await acquire({
      lane: "image",
      estimateMb: 6000,
      reason: "test",
      evicts: "none",
    });
    expect(r.status).toBe("granted");
    expect(typeof r.ticket).toBe("string");
    expect(r.freeAfterMb).toBe(20_000 - 6000);
    expect(listReservations()).toHaveLength(1);
  });

  test("denies when too small and evicts=none", async () => {
    setFree(1000);
    setReserve(2048);
    const r = await acquire({
      lane: "3d",
      estimateMb: 12_000,
      reason: "test",
      evicts: "none",
    });
    expect(r.status).toBe("denied");
    expect(listReservations()).toHaveLength(0);
  });

  test("respects reserveMb headroom", async () => {
    // 6000 MB free, 4000 MB reserve → only 2000 MB really available.
    setFree(6000);
    setReserve(4000);
    const denied = await acquire({
      lane: "image",
      estimateMb: 3000,
      reason: "test",
      evicts: "none",
    });
    expect(denied.status).toBe("denied");
    const ok = await acquire({
      lane: "image",
      estimateMb: 1500,
      reason: "test",
      evicts: "none",
    });
    expect(ok.status).toBe("granted");
  });
});

describe("arbiter.acquire — hard eviction", () => {
  test("evicts a chat reservation to admit a 3d acquire", async () => {
    setFree(20_000);
    setReserve(2048);
    // Grant a chat reservation.
    const chat = await acquire({
      lane: "chat",
      estimateMb: 16_000,
      reason: "chat",
      evicts: "none",
    });
    expect(chat.status).toBe("granted");

    // Now free is 4000. Try a 3d acquire that needs > 4000-reserve.
    // Adjust the ledger to reflect the held memory.
    setFree(4000);

    // After eviction, simulate VRAM coming back. The arbiter polls
    // refreshSnapshot during waitForFree — flip the override.
    let evictionCalled = false;
    ledgerTest.setMemoryOverride(async () => {
      if (!evictionCalled) {
        evictionCalled = true;
        return { totalMb: TOTAL, usedMb: TOTAL - 4000, freeMb: 4000, source: "nvidia-smi" };
      }
      return { totalMb: TOTAL, usedMb: TOTAL - 18_000, freeMb: 18_000, source: "nvidia-smi" };
    });

    const heavy = await acquire({
      lane: "3d",
      estimateMb: 12_000,
      reason: "hunyuan",
      evicts: "hard",
    });

    expect(heavy.status).toBe("granted");
    // Chat reservation should be gone.
    const lanes = listReservations().map((r) => r.lane);
    expect(lanes).toContain("3d");
    expect(lanes).not.toContain("chat");
  });
});

describe("arbiter.release", () => {
  test("returns true once, false afterwards", async () => {
    setFree(20_000);
    setReserve(2048);
    const r = await acquire({
      lane: "image",
      estimateMb: 6000,
      reason: "test",
      evicts: "none",
    });
    expect(r.status).toBe("granted");
    expect(release(r.ticket!)).toBe(true);
    expect(release(r.ticket!)).toBe(false);
    expect(listReservations()).toHaveLength(0);
  });
});

describe("arbiter.acquire — downgrade swap", () => {
  test("downgrades chat to swapTo target instead of full unload", async () => {
    setFree(20_000);
    setReserve(2048);
    arbiterTest.setUnloadOverride(async () => ({ ok: true, via: "test" }));

    // Big chat reservation that declares a smaller swap target.
    // modelId is a llama-swap group id (not a GGUF filename) — that's the
    // string lane-adapters.unloadLlamaSwap forwards as `?model=<id>`.
    const chat = await acquire({
      lane: "chat",
      estimateMb: 16_000,
      reason: "qwen3.5-35b",
      modelId: "qwen3.5-35b",
      swapTo: { modelId: "qwen3.5-9b", estimateMb: 6000 },
      evicts: "none",
      restoreOnIdle: true,
    });
    expect(chat.status).toBe("granted");
    expect(listReservations()).toHaveLength(1);

    // Free shrinks to reflect the held memory, then 3d wants 11 GB.
    setFree(4000);
    let evicted = false;
    ledgerTest.setMemoryOverride(async () => {
      if (!evicted) {
        evicted = true;
        return { totalMb: TOTAL, usedMb: TOTAL - 4000, freeMb: 4000, source: "nvidia-smi" };
      }
      // After unload of the 35B, we get the memory back; the 9B will be loaded lazily.
      return { totalMb: TOTAL, usedMb: TOTAL - 20_000, freeMb: 20_000, source: "nvidia-smi" };
    });

    const heavy = await acquire({
      lane: "3d",
      estimateMb: 11_000,
      reason: "hunyuan",
      evicts: "hard",
    });
    expect(heavy.status).toBe("granted");

    // Chat lane should still be occupied — but at the smaller shape.
    const chatReservations = listReservations().filter((r) => r.lane === "chat");
    expect(chatReservations).toHaveLength(1);
    expect(chatReservations[0].modelId).toBe("qwen3.5-9b");
    expect(chatReservations[0].estimateMb).toBe(6000);
    expect(chatReservations[0].restoreOnIdle).toBe(false);
  });

  test("falls through to full evict when victim has no swapTo", async () => {
    setFree(20_000);
    setReserve(2048);
    arbiterTest.setUnloadOverride(async () => ({ ok: true, via: "test" }));

    const chat = await acquire({
      lane: "chat",
      estimateMb: 16_000,
      reason: "qwen3.5-35b",
      modelId: "qwen3.5-35b",
      evicts: "none",
      restoreOnIdle: false,
    });
    expect(chat.status).toBe("granted");

    setFree(4000);
    let stage = 0;
    ledgerTest.setMemoryOverride(async () => {
      stage += 1;
      if (stage === 1) return { totalMb: TOTAL, usedMb: TOTAL - 4000, freeMb: 4000, source: "nvidia-smi" };
      return { totalMb: TOTAL, usedMb: TOTAL - 20_000, freeMb: 20_000, source: "nvidia-smi" };
    });

    const heavy = await acquire({
      lane: "3d",
      estimateMb: 11_000,
      reason: "hunyuan",
      evicts: "hard",
    });
    expect(heavy.status).toBe("granted");
    // No surviving chat reservation — full eviction took the lane.
    expect(listReservations().filter((r) => r.lane === "chat")).toHaveLength(0);
  });
});

describe("arbiter.reportOom", () => {
  test("drops every reservation on the failing lane", async () => {
    setFree(20_000);
    setReserve(2048);
    const a = await acquire({ lane: "image", estimateMb: 5000, reason: "a", evicts: "none" });
    const b = await acquire({ lane: "image", estimateMb: 4000, reason: "b", evicts: "none" });
    const c = await acquire({ lane: "chat", estimateMb: 3000, reason: "c", evicts: "none" });
    expect(a.status).toBe("granted");
    expect(b.status).toBe("granted");
    expect(c.status).toBe("granted");

    await reportOom("image", "cuda OOM");

    const lanes = listReservations().map((r) => r.lane);
    expect(lanes).toContain("chat");
    expect(lanes).not.toContain("image");
  });
});
