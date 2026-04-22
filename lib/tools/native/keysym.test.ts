import { describe, expect, test } from "bun:test";
import { KEYSYMS, MODIFIERS, parseKeySpec } from "./keysym";

describe("parseKeySpec — primary key resolution", () => {
  test("single ASCII char → codepoint primary, no modifiers", () => {
    const r = parseKeySpec("a");
    expect(r.primary).toBe(0x61);
    expect(r.modifiers).toEqual([]);
  });

  test("digit char", () => {
    expect(parseKeySpec("7").primary).toBe(0x37);
  });

  test("keysym name 'Return' → 0xff0d", () => {
    expect(parseKeySpec("Return").primary).toBe(0xff0d);
  });

  test("keysym names are case-insensitive", () => {
    expect(parseKeySpec("return").primary).toBe(0xff0d);
    expect(parseKeySpec("RETURN").primary).toBe(0xff0d);
    expect(parseKeySpec("RETuRN").primary).toBe(0xff0d);
  });

  test("F10 keysym", () => {
    expect(parseKeySpec("F10").primary).toBe(0xffc7);
  });

  test("'enter' is aliased to Return", () => {
    expect(parseKeySpec("enter").primary).toBe(KEYSYMS.return);
  });

  test("arrow keys", () => {
    expect(parseKeySpec("Up").primary).toBe(0xff52);
    expect(parseKeySpec("Down").primary).toBe(0xff54);
    expect(parseKeySpec("Left").primary).toBe(0xff51);
    expect(parseKeySpec("Right").primary).toBe(0xff53);
  });
});

describe("parseKeySpec — modifier combos", () => {
  test("Ctrl+a", () => {
    const r = parseKeySpec("Ctrl+a");
    expect(r.modifiers).toEqual([MODIFIERS.ctrl]);
    expect(r.primary).toBe(0x61);
  });

  test("Ctrl+Shift+Tab preserves order (Ctrl first)", () => {
    const r = parseKeySpec("Ctrl+Shift+Tab");
    expect(r.modifiers).toEqual([MODIFIERS.ctrl, MODIFIERS.shift]);
    expect(r.primary).toBe(0xff09);
  });

  test("Alt+F10 works", () => {
    const r = parseKeySpec("Alt+F10");
    expect(r.modifiers).toEqual([MODIFIERS.alt]);
    expect(r.primary).toBe(0xffc7);
  });

  test("'Control' alias for Ctrl", () => {
    expect(parseKeySpec("Control+a").modifiers).toEqual([MODIFIERS.ctrl]);
  });

  test("Super+Up (windows key combo)", () => {
    const r = parseKeySpec("Super+Up");
    expect(r.modifiers).toEqual([MODIFIERS.super]);
    expect(r.primary).toBe(0xff52);
  });

  test("unknown modifier is silently dropped, not errored", () => {
    // parseKeySpec filters unknown modifier names — it matches the Linux
    // adapter's permissive behavior so typos don't crash the agent mid-run.
    const r = parseKeySpec("Bogus+a");
    expect(r.modifiers).toEqual([]);
    expect(r.primary).toBe(0x61);
  });
});

describe("parseKeySpec — literal + and space edge cases", () => {
  test("bare '+' is a literal plus, not an empty combo", () => {
    const r = parseKeySpec("+");
    expect(r.modifiers).toEqual([]);
    expect(r.primary).toBe(0x2b);
  });

  test("bare ' ' (space) is the Space key", () => {
    const r = parseKeySpec(" ");
    expect(r.modifiers).toEqual([]);
    // space primary is the Unicode codepoint (0x20), which happens to
    // equal the keysym for Space too.
    expect(r.primary).toBe(0x20);
  });
});

describe("parseKeySpec — failure modes", () => {
  test("empty string throws", () => {
    expect(() => parseKeySpec("")).toThrow(/empty key spec/);
  });

  test("multi-character unknown name throws", () => {
    expect(() => parseKeySpec("Bogus")).toThrow(/unknown key/);
  });

  test("combo with unknown primary throws", () => {
    expect(() => parseKeySpec("Ctrl+Nonsense")).toThrow(/unknown key/);
  });
});

describe("KEYSYMS + MODIFIERS maps — invariants", () => {
  test("all expected modifier names resolve", () => {
    for (const m of ["shift", "ctrl", "control", "alt", "super", "meta"]) {
      expect(typeof MODIFIERS[m]).toBe("number");
    }
  });

  test("F1..F12 are contiguous X11 keysyms", () => {
    for (let i = 1; i <= 12; i++) {
      const code = KEYSYMS[`f${i}`];
      expect(typeof code).toBe("number");
    }
    expect(KEYSYMS.f12 - KEYSYMS.f1).toBe(11);
  });

  test("return and enter map to the same keysym", () => {
    expect(KEYSYMS.return).toBe(KEYSYMS.enter);
  });

  test("ctrl and control are the same", () => {
    expect(MODIFIERS.ctrl).toBe(MODIFIERS.control);
  });
});
