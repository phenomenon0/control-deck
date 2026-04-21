/**
 * LiveTransport pure-helper tests.
 *
 * Audio behavior (Tone nodes, transport timing) isn't covered here — it needs
 * a browser / Tone.OfflineContext and gets smoke-tested in Phase 3 when
 * LivePane is swapped onto the new transport.
 *
 * Run with: bun test lib/live/transport.test.ts
 */

import { describe, expect, test } from "bun:test";
import { buildPatternEvents, diffById, isNote, stepTimeBBS } from "./transport";
import type { Pattern } from "./model";

describe("isNote", () => {
  test("accepts pitch+octave", () => {
    for (const s of ["c2", "C3", "d#4", "eb-1", "a5", "G#7"]) {
      expect(isNote(s)).toBe(true);
    }
  });
  test("rejects drum tags and rests", () => {
    for (const s of ["bd", "sd", "hh", "oh", "cp", "sub", "bass", "x"]) {
      expect(isNote(s)).toBe(false);
    }
  });
});

describe("stepTimeBBS", () => {
  test("16n: step 0 / 4 / 15 / 16 / 32", () => {
    expect(stepTimeBBS(0, "16n")).toBe("0:0:0");
    expect(stepTimeBBS(4, "16n")).toBe("0:1:0");
    expect(stepTimeBBS(15, "16n")).toBe("0:3:3");
    expect(stepTimeBBS(16, "16n")).toBe("1:0:0");
    expect(stepTimeBBS(32, "16n")).toBe("2:0:0");
  });
  test("8n halves the grid density", () => {
    // 8n step i == 16n step i*2
    expect(stepTimeBBS(1, "8n")).toBe(stepTimeBBS(2, "16n"));
    expect(stepTimeBBS(8, "8n")).toBe(stepTimeBBS(16, "16n"));
  });
  test("32n doubles density", () => {
    // 32n step i*2 == 16n step i
    expect(stepTimeBBS(2, "32n")).toBe(stepTimeBBS(1, "16n"));
    expect(stepTimeBBS(32, "32n")).toBe(stepTimeBBS(16, "16n"));
  });
});

describe("diffById", () => {
  const a = { id: "a", v: 1 };
  const b = { id: "b", v: 1 };
  const c = { id: "c", v: 1 };

  test("empty before / after", () => {
    expect(diffById([], [])).toEqual({ added: [], removed: [], changed: [] });
  });
  test("added-only", () => {
    const r = diffById([], [a, b]);
    expect(r.added).toEqual([a, b]);
    expect(r.removed).toEqual([]);
    expect(r.changed).toEqual([]);
  });
  test("removed-only", () => {
    const r = diffById([a, b], []);
    expect(r.removed).toEqual([a, b]);
    expect(r.added).toEqual([]);
    expect(r.changed).toEqual([]);
  });
  test("same references → no change", () => {
    const r = diffById([a, b], [a, b]);
    expect(r.changed).toEqual([]);
  });
  test("different reference same id → changed", () => {
    const aPrime = { id: "a", v: 2 };
    const r = diffById([a, b], [aPrime, b]);
    expect(r.changed).toEqual([aPrime]);
  });
  test("mix: add + remove + change", () => {
    const aPrime = { id: "a", v: 9 };
    const r = diffById([a, b], [aPrime, c]);
    expect(r.added).toEqual([c]);
    expect(r.removed).toEqual([b]);
    expect(r.changed).toEqual([aPrime]);
  });
});

describe("buildPatternEvents", () => {
  const ch = "ch-1";
  const pattern: Pattern = {
    id: "p",
    name: "main",
    lengthBars: 1,
    stepDiv: "16n",
    slices: {
      [ch]: {
        channelId: ch,
        steps: ["bd", null, "bd", null, null, null, "bd", null],
      },
    },
  };

  test("skips rests (null), emits events for non-null steps", () => {
    const events = buildPatternEvents(pattern, ch);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.step)).toEqual(["bd", "bd", "bd"]);
    expect(events[0].time).toBe(stepTimeBBS(0, "16n"));
    expect(events[1].time).toBe(stepTimeBBS(2, "16n"));
    expect(events[2].time).toBe(stepTimeBBS(6, "16n"));
  });

  test("empty slice for channel → []", () => {
    const empty = buildPatternEvents(pattern, "other-channel");
    expect(empty).toEqual([]);
  });

  test("all-rest slice → []", () => {
    const p: Pattern = { ...pattern, slices: { [ch]: { channelId: ch, steps: [null, null, null] } } };
    expect(buildPatternEvents(p, ch)).toEqual([]);
  });

  test("respects stepDiv", () => {
    const p: Pattern = {
      ...pattern,
      stepDiv: "8n",
      slices: { [ch]: { channelId: ch, steps: ["bd", null, "bd"] } },
    };
    const events = buildPatternEvents(p, ch);
    expect(events[0].time).toBe("0:0:0");
    expect(events[1].time).toBe(stepTimeBBS(2, "8n"));
  });
});
