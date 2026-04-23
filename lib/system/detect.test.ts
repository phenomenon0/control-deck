import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { detectSystem, formatSystemProfile, type SystemProfile } from "./detect";

// ── formatSystemProfile ─────────────────────────────────────────────
// Pure formatter — straightforward to test with synthetic inputs.

describe("formatSystemProfile", () => {
  const base: SystemProfile = {
    mode: "lite",
    gpu: null,
    ram: 16,
    cpuCores: 8,
    cpuModel: "Intel i7-9700K",
    isIntel: true,
    platform: "win32",
    backend: "cpu",
    storage: null,
    recommended: {
      textModel: "qwen2",
      imageBackend: "comfy",
      imageResolution: 256,
    },
  };

  test("uppercases mode in header", () => {
    expect(formatSystemProfile(base)).toMatch(/Mode: LITE/);
  });

  test("reports 'GPU: None detected' when gpu is null", () => {
    expect(formatSystemProfile(base)).toContain("GPU: None detected");
  });

  test("formats GPU with VRAM rounded to GB", () => {
    const withGpu: SystemProfile = {
      ...base,
      gpu: { name: "RTX 4090", vram: 24564 },
    };
    const out = formatSystemProfile(withGpu);
    expect(out).toContain("GPU: RTX 4090 (24GB VRAM)");
  });

  test("includes each recommended field on its own line", () => {
    const out = formatSystemProfile(base);
    expect(out).toContain("Recommended text model: qwen2");
    expect(out).toContain("Recommended image backend: comfy");
    expect(out).toContain("Recommended image resolution: 256px");
  });

  test("multi-line output uses \\n separators", () => {
    const out = formatSystemProfile(base);
    expect(out.split("\n").length).toBeGreaterThan(5);
  });

  test("power mode profile formats cleanly", () => {
    const power: SystemProfile = {
      ...base,
      mode: "power",
      gpu: { name: "RTX 3090", vram: 24000 },
      ram: 32,
      recommended: { textModel: "qwen2", imageBackend: "comfy", imageResolution: 768 },
    };
    const out = formatSystemProfile(power);
    expect(out).toContain("Mode: POWER");
    expect(out).toContain("Recommended image backend: comfy");
  });
});

// ── detectSystem — env-controlled mode path ────────────────────────
// Can't reliably test GPU/RAM detection in a hermetic spec, but the
// CONTROL_DECK_MODE env override lets us verify the mode-selection
// plumbing independent of hardware.

describe("detectSystem — CONTROL_DECK_MODE override", () => {
  const originalMode = process.env.CONTROL_DECK_MODE;

  beforeEach(() => {
    delete process.env.CONTROL_DECK_MODE;
  });
  afterEach(() => {
    if (originalMode === undefined) delete process.env.CONTROL_DECK_MODE;
    else process.env.CONTROL_DECK_MODE = originalMode;
  });

  test("'lite' override forces lite mode", () => {
    process.env.CONTROL_DECK_MODE = "lite";
    expect(detectSystem().mode).toBe("lite");
  });

  test("'power' override forces power mode regardless of hardware", () => {
    process.env.CONTROL_DECK_MODE = "power";
    expect(detectSystem().mode).toBe("power");
  });

  test("override is case-insensitive", () => {
    process.env.CONTROL_DECK_MODE = "LITE";
    expect(detectSystem().mode).toBe("lite");
    process.env.CONTROL_DECK_MODE = "Power";
    expect(detectSystem().mode).toBe("power");
  });

  test("unknown value falls through to hardware-based mode detection", () => {
    process.env.CONTROL_DECK_MODE = "nonsense";
    // With no env-override match, the mode comes from hardware detection.
    // We can't assert the specific outcome (depends on this machine), but
    // it MUST be one of the valid enum values.
    expect(["lite", "power"]).toContain(detectSystem().mode);
  });
});

describe("detectSystem — shape invariants", () => {
  test("returned profile has all required fields with sensible types", () => {
    const p = detectSystem();
    expect(["lite", "power"]).toContain(p.mode);
    expect(typeof p.ram).toBe("number");
    expect(p.ram).toBeGreaterThan(0);
    expect(typeof p.cpuCores).toBe("number");
    expect(p.cpuCores).toBeGreaterThan(0);
    expect(typeof p.cpuModel).toBe("string");
    expect(typeof p.isIntel).toBe("boolean");
    expect(typeof p.platform).toBe("string");
    expect(p.recommended).toMatchObject({
      textModel: expect.any(String),
      imageBackend: "comfy",
      imageResolution: expect.any(Number),
    });
  });

  test("power mode uses 768, lite uses 256; both route to comfy", () => {
    process.env.CONTROL_DECK_MODE = "power";
    const powerP = detectSystem();
    expect(powerP.recommended.imageBackend).toBe("comfy");
    expect(powerP.recommended.imageResolution).toBe(768);

    process.env.CONTROL_DECK_MODE = "lite";
    const liteP = detectSystem();
    expect(liteP.recommended.imageBackend).toBe("comfy");
    expect(liteP.recommended.imageResolution).toBe(256);

    delete process.env.CONTROL_DECK_MODE;
  });

  test("LLM_MODEL env var flows through to recommended.textModel", () => {
    const original = process.env.LLM_MODEL;
    process.env.LLM_MODEL = "custom-model-name";
    expect(detectSystem().recommended.textModel).toBe("custom-model-name");
    if (original === undefined) delete process.env.LLM_MODEL;
    else process.env.LLM_MODEL = original;
  });
});
