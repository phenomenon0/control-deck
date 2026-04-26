import { describe, expect, it } from "bun:test";

import { recommendTier, tierDiskMb, HARDWARE_TIERS } from "./hardware-tiers";

describe("recommendTier", () => {
  it("picks T1_MAC for Apple Silicon with ≥14 GB unified memory", () => {
    const r = recommendTier({
      backend: "metal",
      gpu: { name: "Apple M2 Pro", vram: 16384, unifiedMemory: true },
      ramGb: 16,
    });
    expect(r.best).toBe("T1_MAC");
    expect(r.scores.T1_MAC).toBeGreaterThanOrEqual(100);
  });

  it("picks T2_CUDA for an RTX 4070-class card", () => {
    const r = recommendTier({
      backend: "cuda",
      gpu: { name: "NVIDIA GeForce RTX 4070 Ti Super", vram: 16384 },
      ramGb: 32,
    });
    expect(r.best).toBe("T2_CUDA");
    expect(r.scores.T2_CUDA).toBeGreaterThanOrEqual(100);
  });

  it("picks T3_CPU for an Intel iGPU laptop", () => {
    const r = recommendTier({
      backend: "cpu",
      gpu: { name: "Intel UHD Graphics", vram: 1024 },
      ramGb: 16,
    });
    expect(r.best).toBe("T3_CPU");
    expect(r.scores.T3_CPU).toBeGreaterThanOrEqual(100);
  });

  it("falls back to T3_CPU when no GPU is present", () => {
    const r = recommendTier({ backend: "cpu", gpu: null, ramGb: 16 });
    expect(r.best).toBe("T3_CPU");
  });

  it("scales CUDA fit by VRAM tier", () => {
    const sixGb = recommendTier({
      backend: "cuda",
      gpu: { name: "GTX 1660", vram: 6144 },
      ramGb: 16,
    });
    const tenGb = recommendTier({
      backend: "cuda",
      gpu: { name: "RTX 3080 10GB", vram: 10240 },
      ramGb: 32,
    });
    const sixteenGb = recommendTier({
      backend: "cuda",
      gpu: { name: "RTX 4070 Ti Super", vram: 16384 },
      ramGb: 32,
    });
    expect(sixGb.scores.T2_CUDA).toBe(30);
    expect(tenGb.scores.T2_CUDA).toBe(70);
    expect(sixteenGb.scores.T2_CUDA).toBe(100);
    // A 6 GB CUDA card still beats the CPU fallback (20).
    expect(sixGb.best).toBe("T2_CUDA");
  });
});

describe("tierDiskMb", () => {
  it("sums cascade lanes by default and adds omni when requested", () => {
    const t2 = HARDWARE_TIERS.T2_CUDA;
    const cascadeOnly = tierDiskMb(t2);
    const withOmni = tierDiskMb(t2, { includeOmni: true });
    expect(cascadeOnly).toBe(
      (t2.cascade.stt.sizeMb ?? 0) +
        (t2.cascade.tts.sizeMb ?? 0) +
        (t2.cascade.llm.sizeMb ?? 0),
    );
    expect(withOmni).toBe(cascadeOnly + (t2.omni?.sizeMb ?? 0));
  });

  it("ignores omni for tiers that don't ship one", () => {
    expect(HARDWARE_TIERS.T3_CPU.omni).toBeUndefined();
    expect(tierDiskMb(HARDWARE_TIERS.T3_CPU, { includeOmni: true })).toBe(
      tierDiskMb(HARDWARE_TIERS.T3_CPU),
    );
  });
});
