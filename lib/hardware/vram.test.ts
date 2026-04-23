/**
 * Pure math tests — no DB, no fs. Covers every verdict branch.
 */

import { describe, expect, test } from "bun:test";
import { canFit, estimateVramMb, fitLabel } from "./vram";

describe("estimateVramMb", () => {
  test("returns 0 for non-positive input", () => {
    expect(estimateVramMb(0)).toBe(0);
    expect(estimateVramMb(-1)).toBe(0);
    expect(estimateVramMb(NaN)).toBe(0);
  });

  test("applies 1.3 overhead + 512 MB flat", () => {
    // 1 GB on disk → 1024 * 1.3 + 512 = 1843.2 → 1843
    expect(estimateVramMb(1024 * 1024 * 1024)).toBe(1843);
  });

  test("scales with size", () => {
    const small = estimateVramMb(500 * 1024 * 1024);
    const big = estimateVramMb(5 * 1024 * 1024 * 1024);
    expect(big).toBeGreaterThan(small * 5); // monotonic
  });
});

describe("canFit", () => {
  const makeGpu = (totalMb: number, usedMb: number) => ({
    name: "test",
    memoryTotal: totalMb,
    memoryUsed: usedMb,
    memoryPercent: (usedMb / totalMb) * 100,
    utilization: 0,
    temperature: 0,
  });

  test("unknown when no GPU info", () => {
    const r = canFit(2000, null);
    expect(r.verdict).toBe("unknown");
    expect(r.freeMb).toBe(null);
  });

  test("ok when fits with plenty of reserve", () => {
    const gpu = makeGpu(24_000, 4_000); // 20 GB free
    const r = canFit(2_000, gpu, 2048);
    expect(r.verdict).toBe("ok");
    expect(r.freeAfterMb).toBe(18_000);
  });

  test("warn when over reserve threshold but still fits", () => {
    const gpu = makeGpu(8_000, 5_000); // 3 GB free
    const r = canFit(2_000, gpu, 2048);
    expect(r.verdict).toBe("warn");
    expect(r.freeAfterMb).toBe(1_000); // under 2 GB reserve
  });

  test("block when estimate exceeds free", () => {
    const gpu = makeGpu(8_000, 6_000); // 2 GB free
    const r = canFit(5_000, gpu, 0);
    expect(r.verdict).toBe("block");
    expect(r.freeAfterMb).toBeLessThan(0);
  });

  test("reserve=0 still fits when exact", () => {
    const gpu = makeGpu(8_000, 0); // 8 GB free
    const r = canFit(8_000, gpu, 0);
    expect(r.verdict).toBe("ok");
    expect(r.freeAfterMb).toBe(0);
  });
});

describe("fitLabel", () => {
  test("maps verdicts to short labels", () => {
    expect(fitLabel("ok")).toBe("fits");
    expect(fitLabel("warn")).toBe("tight");
    expect(fitLabel("block")).toBe("too big");
    expect(fitLabel("unknown")).toBe("—");
  });
});
