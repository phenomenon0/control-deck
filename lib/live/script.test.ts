import { describe, expect, test } from "bun:test";
import { LIVE_FX_TYPES, parseLiveScript } from "./script";

describe("parseLiveScript — bpm", () => {
  test("clamps bpm to 40..300 range", () => {
    expect(parseLiveScript("bpm 10").bpm).toBe(40);
    expect(parseLiveScript("bpm 999").bpm).toBe(300);
    expect(parseLiveScript("bpm 120").bpm).toBe(120);
  });

  test("decimal bpm is accepted", () => {
    expect(parseLiveScript("bpm 128.5").bpm).toBe(128.5);
  });

  test("case-insensitive keyword", () => {
    expect(parseLiveScript("BPM 140").bpm).toBe(140);
  });

  test("no bpm line → undefined", () => {
    expect(parseLiveScript("0: xxxx").bpm).toBeUndefined();
  });
});

describe("parseLiveScript — tracks", () => {
  test("parses a simple 8-step pattern", () => {
    const p = parseLiveScript("0: x.x.x.x.");
    expect(p.tracks).toHaveLength(1);
    expect(p.tracks[0].track).toBe(0);
    expect(p.tracks[0].pattern).toBe("x.x.x.x.");
    expect(p.tracks[0].steps.length).toBeGreaterThan(0);
  });

  test("captures optional track name", () => {
    const p = parseLiveScript("2 hats: x.x.x.x.");
    expect(p.tracks[0].name).toBe("hats");
  });

  test("rejects track numbers outside 0-7", () => {
    const p = parseLiveScript("9: xxxx");
    expect(p.tracks).toHaveLength(0);
    expect(p.errors[0]).toMatch(/Line 1.*must be 0-7/);
  });

  test("multiple tracks accumulate in order", () => {
    const p = parseLiveScript("0: x...\n1: .x..\n2: ..x.");
    expect(p.tracks.map((t) => t.track)).toEqual([0, 1, 2]);
  });
});

describe("parseLiveScript — fx chains", () => {
  test("single FX with default wet", () => {
    const p = parseLiveScript("fx 0: reverb");
    expect(p.fxChains).toHaveLength(1);
    expect(p.fxChains[0].track).toBe(0);
    expect(p.fxChains[0].chain).toEqual([{ type: "reverb", wet: 0.4 }]);
  });

  test("chain separators > and , both work", () => {
    const p1 = parseLiveScript("fx 0: reverb > delay > chorus");
    const p2 = parseLiveScript("fx 0: reverb, delay, chorus");
    expect(p1.fxChains[0].chain.map((c) => c.type)).toEqual(["reverb", "delay", "chorus"]);
    expect(p2.fxChains[0].chain.map((c) => c.type)).toEqual(["reverb", "delay", "chorus"]);
  });

  test("paren-form wet (reverb(0.8))", () => {
    const p = parseLiveScript("fx 0: reverb(0.8)");
    expect(p.fxChains[0].chain[0].wet).toBe(0.8);
  });

  test("space-form wet (reverb 0.3)", () => {
    const p = parseLiveScript("fx 0: reverb 0.3");
    expect(p.fxChains[0].chain[0].wet).toBeCloseTo(0.3);
  });

  test("wet > 1 clamped down to 1", () => {
    const p = parseLiveScript("fx 0: reverb(2.5)");
    expect(p.fxChains[0].chain[0].wet).toBe(1);
  });

  test("wet below 1 accepted as-is", () => {
    const p = parseLiveScript("fx 0: delay(0)");
    expect(p.fxChains[0].chain[0].wet).toBe(0);
  });

  test("unknown fx name (well-formed token) → Unknown FX error", () => {
    const p = parseLiveScript("fx 0: kazoo");
    expect(p.fxChains).toHaveLength(0);
    expect(p.errors[0]).toMatch(/Unknown FX/);
  });

  test("malformed fx token → Invalid FX token error", () => {
    const p = parseLiveScript("fx 0: quantum_flux");
    expect(p.fxChains).toHaveLength(0);
    expect(p.errors[0]).toMatch(/Invalid FX token/);
  });

  test("every documented fx type is accepted", () => {
    for (const fx of LIVE_FX_TYPES) {
      const p = parseLiveScript(`fx 0: ${fx}`);
      expect(p.fxChains[0].chain[0].type).toBe(fx);
      expect(p.errors).toEqual([]);
    }
  });
});

describe("parseLiveScript — samples", () => {
  test("parses bare prompt", () => {
    const p = parseLiveScript("sample 0: warm analog pad");
    expect(p.samples).toHaveLength(1);
    expect(p.samples[0].track).toBe(0);
    expect(p.samples[0].prompt).toBe("warm analog pad");
    expect(p.samples[0].duration).toBe(8); // default
    expect(p.samples[0].loader).toBe("stable-audio"); // default
  });

  test("name + prompt", () => {
    const p = parseLiveScript("sample 3 bassoon: warm wooden bass stab");
    expect(p.samples[0].name).toBe("bassoon");
    expect(p.samples[0].prompt).toBe("warm wooden bass stab");
  });

  test("options: duration, seed, loader", () => {
    const p = parseLiveScript("sample 0: ambient drone duration=12 seed=42 loader=ace-step");
    expect(p.samples[0].duration).toBe(12);
    expect(p.samples[0].seed).toBe(42);
    expect(p.samples[0].loader).toBe("ace-step");
    expect(p.samples[0].prompt).toBe("ambient drone");
  });

  test("duration clamped to [1, 47]", () => {
    expect(parseLiveScript("sample 0: x duration=0.1").samples[0].duration).toBe(1);
    expect(parseLiveScript("sample 0: x duration=100").samples[0].duration).toBe(47);
  });

  test("loader defaults to stable-audio unless ace-step requested", () => {
    expect(parseLiveScript("sample 0: x loader=mystery").samples[0].loader).toBe("stable-audio");
    expect(parseLiveScript("sample 0: x loader=ace-step").samples[0].loader).toBe("ace-step");
  });

  test("quoted prompt option overrides inline", () => {
    const p = parseLiveScript('sample 0: should be ignored prompt="exact prompt here"');
    expect(p.samples[0].prompt).toBe("exact prompt here");
  });

  test("missing prompt → error", () => {
    const p = parseLiveScript("sample 0: duration=5");
    expect(p.samples).toHaveLength(0);
    expect(p.errors[0]).toMatch(/needs a prompt/);
  });
});

describe("parseLiveScript — whitespace + comments + errors", () => {
  test("blank lines ignored", () => {
    const p = parseLiveScript("\n\n0: xxxx\n\n");
    expect(p.tracks).toHaveLength(1);
    expect(p.errors).toEqual([]);
  });

  test("// comments ignored", () => {
    const p = parseLiveScript("// a header\n0: xxxx\n// tail");
    expect(p.tracks).toHaveLength(1);
    expect(p.errors).toEqual([]);
  });

  test("unknown lines produce 'ignored' errors with line numbers", () => {
    const p = parseLiveScript("0: xxxx\nthis is nonsense\nfx 1: reverb");
    expect(p.tracks).toHaveLength(1);
    expect(p.fxChains).toHaveLength(1);
    expect(p.errors.some((e) => /Line 2.*ignored/.test(e))).toBe(true);
  });

  test("error from one line doesn't abort subsequent parsing", () => {
    const p = parseLiveScript("99: xxxx\n0: x.x.");
    expect(p.tracks).toHaveLength(1);
    expect(p.tracks[0].track).toBe(0);
    expect(p.errors.length).toBe(1);
  });
});
