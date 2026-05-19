import { describe, expect, it } from "bun:test";

import { checkHardwareFloor } from "./orchestrator";
import type { ProbeResult } from "./orchestrator";
import { HARDWARE_TIERS } from "@/lib/inference/hardware-tiers";

// `tier.diskMb` (cascade) is computed once for the floor math. Keep the
// probe lean — checkHardwareFloor only reads ramGb + storage (via
// detectSystem). All other fields exist purely to satisfy ProbeResult.
function fakeProbe(ramGb: number): ProbeResult {
  return {
    hardware: { backend: "cpu", gpu: null, ramGb },
    tier: "T3_CPU",
    tierLabel: "Consumer · CPU",
    diskMb: 0,
    llm: { id: "llama3.2:3b", sizeMb: 2000, runner: "ollama" },
    stt: { id: "sherpa", sizeMb: 320 },
    tts: { id: "kokoro", sizeMb: 338 },
    missing: {
      ollama: false,
      ollamaService: false,
      llmModel: false,
      voiceCore: false,
      sttEngine: false,
      ttsEngine: false,
    },
    installPlan: null,
    ollamaVersion: null,
    done: false,
  };
}

describe("checkHardwareFloor", () => {
  const tier = HARDWARE_TIERS.T3_CPU;

  it("fails when RAM is below the 6 GB floor", () => {
    // 4 GB is below the LLM-thrashing threshold — must abort BEFORE the
    // multi-gig pull rather than letting smoke OOM at the end.
    const result = checkHardwareFloor(fakeProbe(4), tier);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.detail).toMatch(/RAM/);
      expect(result.detail).toMatch(/6 GB/);
    }
  });

  it("warns but proceeds at 6–7 GB RAM (tight-but-workable)", () => {
    // 7 GB is enough for the smallest tier LLM to load but slow. The user
    // should know what they're in for, not be silently blocked.
    const result = checkHardwareFloor(fakeProbe(7), tier);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warn).toMatch(/tight/);
    }
  });

  it("passes silently with comfortable headroom", () => {
    const result = checkHardwareFloor(fakeProbe(16), tier);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warn).toBeUndefined();
    }
  });

  it("treats ramGb=0 as 'unknown' and skips the RAM check", () => {
    // Some hardware-detection paths return 0 when they can't read meminfo.
    // We'd rather try than block on missing data — the smoke test catches
    // genuine OOM at the end.
    const result = checkHardwareFloor(fakeProbe(0), tier);
    expect(result.ok).toBe(true);
  });
});
