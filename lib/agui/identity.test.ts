/**
 * Canonical-JSON fingerprint identity tests (SPEC-CANON.md dogfood).
 *
 * Proves on the real DeckPayload surface:
 *  (a) `fp` is stable across key-order / whitespace variants of the same data,
 *  (b) two different data values get different `fp`,
 *  (c) `fp` is absent (never wrong) when data contains a > 2^53 int or NaN.
 *
 * Run with: bun test lib/agui/identity.test.ts
 */

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { canonJson, fromJsonLoose } from "cowrie-glyph";
import { fingerprintData } from "./identity";
import {
  deserializePayload,
  isDeckPayload,
  isJsonPayload,
  jsonPayload,
  serializePayload,
  smartEncode,
  type DeckPayload,
} from "./payload";
import { wrapPayload } from "./events";

describe("fingerprintData", () => {
  test("returns 64 lowercase hex", () => {
    const fp = fingerprintData({ a: 1, b: "x" });
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  test("matches the official digest: sha256 of canonical JSON", () => {
    const data = { z: [1, 2.5, "s"], a: true, n: null };
    const fp = fingerprintData(data);
    // Independent oracle: hex(sha256(canonJson(fromJsonLoose(json)))) —
    // canonJson sorts keys and normalizes numbers before hashing.
    const gv = fromJsonLoose(JSON.parse(JSON.stringify(data)));
    const expected = createHash("sha256").update(canonJson(gv), "utf8").digest("hex");
    expect(fp).toBe(expected);
  });

  test("scalar roots are fingerprintable", () => {
    expect(fingerprintData(null)).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprintData("hello")).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprintData(42)).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprintData(true)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("DeckPayload fp — identity on a real JSON state surface", () => {
  /** fp of a json-kind payload (narrowing helper), undefined otherwise. */
  function fpOf(p: DeckPayload): string | undefined {
    return isJsonPayload(p) ? p.fp : undefined;
  }

  test("(a) fp is stable across key-order and whitespace variants of the same data", () => {
    const v1 = { b: 1, a: { y: 2, x: [1, 2] }, c: "same" };
    const v2 = JSON.parse('{ "c": "same", "a": { "x": [1, 2], "y": 2 }, "b": 1 }');
    const p1 = jsonPayload(v1);
    const p2 = jsonPayload(v2);
    expect(p1.kind).toBe("json");
    expect(fpOf(p1)).toMatch(/^[0-9a-f]{64}$/);
    expect(fpOf(p1)).toBe(fpOf(p2));
  });

  test("(b) two different data values get different fp", () => {
    const fpA = fpOf(jsonPayload({ id: 1, role: "user" }));
    const fpB = fpOf(jsonPayload({ id: 2, role: "user" }));
    const fpC = fpOf(jsonPayload({ id: 1, role: "assistant" }));
    expect(fpA).toBeDefined();
    expect(fpA).not.toBe(fpB);
    expect(fpA).not.toBe(fpC);
  });

  test("(c) fp is absent (not wrong) when data contains an int > 2^53", () => {
    // JSON.parse collapses the literal to a double ≥ 2^53; identity refuses to
    // fingerprint a precision-collapsed integer (it must travel as a string).
    const big = JSON.parse('{"big": 9007199254740993}');
    expect(big.big).toBe(9007199254740992); // collapsed by JSON.parse — the trap
    expect(fpOf(jsonPayload(big))).toBeUndefined();
  });

  test("(c) fp is absent (not wrong) when data contains NaN or Infinity", () => {
    expect(fpOf(jsonPayload({ a: NaN }))).toBeUndefined();
    expect(fpOf(jsonPayload({ a: Infinity }))).toBeUndefined();
    expect(fpOf(jsonPayload({ outer: { inner: [1, NaN] } }))).toBeUndefined();
  });

  test("-0.0 and 0 fingerprint identically (canonical int digits)", () => {
    const pNeg = fpOf(jsonPayload({ n: -0 }));
    const pPos = fpOf(jsonPayload({ n: 0 }));
    expect(pNeg).toBe(pPos);
  });

  test("floats keep float identity but integral floats collapse to int digits", () => {
    const fpFloat = fpOf(jsonPayload({ n: 1.5 }));
    const fpInt = fpOf(jsonPayload({ n: 1 }));
    const fpOnePointZero = fpOf(jsonPayload({ n: 1.0 }));
    expect(fpFloat).not.toBe(fpInt);
    expect(fpOnePointZero).toBe(fpInt); // 1.0 → 1
  });

  test("fp round-trips through serializePayload / deserializePayload", () => {
    const original = jsonPayload({ deep: { list: [1, 2, 3] }, ok: true });
    const restored = deserializePayload(serializePayload(original));
    expect(restored.kind).toBe("json");
    expect(fpOf(restored)).toBe(fpOf(original));
  });

  test("wrapPayload (events/message store path) stamps fp on wrapped data", () => {
    const wrapped = wrapPayload({ role: "user", content: "hello" });
    expect(wrapped.kind).toBe("json");
    expect(fpOf(wrapped)).toMatch(/^[0-9a-f]{64}$/);
    // Legacy string normalization also gets identity.
    const wrappedStr = wrapPayload("done");
    expect(wrappedStr.kind).toBe("json");
    expect(fpOf(wrappedStr)).toMatch(/^[0-9a-f]{64}$/);
  });

  test("smartEncode JSON fallback carries fp", () => {
    const p = smartEncode({ a: 1 }); // tiny → json kind
    expect(p.kind).toBe("json");
    expect(fpOf(p)).toMatch(/^[0-9a-f]{64}$/);
  });

  test("isDeckPayload / isJsonPayload accept the fp field", () => {
    const p = jsonPayload({ x: 1 });
    expect(isJsonPayload(p)).toBe(true);
    expect(fpOf(p)).toMatch(/^[0-9a-f]{64}$/);
    expect(isDeckPayload(p)).toBe(true);
    expect(JSON.parse(serializePayload(p))).toMatchObject({ kind: "json", fp: fpOf(p) });
  });

  test("cyclic data gets no fp and no crash", () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(fingerprintData(cyclic as unknown)).toBeNull();
    expect(() => fingerprintData(cyclic as unknown, false)).not.toThrow();
  });
});
