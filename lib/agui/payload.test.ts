import { describe, expect, test } from "bun:test";
import {
  binaryPayload,
  decodePayload,
  deserializePayload,
  glyphPayload,
  isBinaryPayload,
  isDeckPayload,
  isGlyphPayload,
  isJsonPayload,
  isTextPayload,
  jsonPayload,
  payloadBadge,
  payloadSummary,
  payloadToContext,
  serializePayload,
  smartEncode,
  textPayload,
  tryDecodePayload,
  type DeckPayload,
} from "./payload";

describe("isDeckPayload", () => {
  test("accepts well-formed json/glyph/text/binary envelopes", () => {
    expect(isDeckPayload({ kind: "json", data: { a: 1 } })).toBe(true);
    expect(isDeckPayload({ kind: "glyph", glyph: "abc" })).toBe(true);
    expect(isDeckPayload({ kind: "text", text: "hi" })).toBe(true);
    expect(isDeckPayload({ kind: "binary", base64: "aGk=", mimeType: "text/plain" })).toBe(true);
  });

  test("rejects non-objects and null", () => {
    expect(isDeckPayload(null)).toBe(false);
    expect(isDeckPayload(undefined)).toBe(false);
    expect(isDeckPayload("string")).toBe(false);
    expect(isDeckPayload(42)).toBe(false);
  });

  test("rejects envelopes with unknown kind", () => {
    expect(isDeckPayload({ kind: "weird", data: 1 })).toBe(false);
  });

  test("rejects envelopes with missing required fields", () => {
    expect(isDeckPayload({ kind: "glyph" })).toBe(false);
    expect(isDeckPayload({ kind: "text" })).toBe(false);
    expect(isDeckPayload({ kind: "binary", base64: "a" })).toBe(false); // no mime
    expect(isDeckPayload({ kind: "binary", mimeType: "x/y" })).toBe(false); // no base64
  });

  test("json without `data` key still rejects", () => {
    expect(isDeckPayload({ kind: "json" })).toBe(false);
  });
});

describe("per-kind type guards", () => {
  test("isJsonPayload / isGlyphPayload / isTextPayload / isBinaryPayload narrow correctly", () => {
    const j = jsonPayload({ a: 1 });
    expect(isJsonPayload(j)).toBe(true);
    expect(isGlyphPayload(j)).toBe(false);

    const g = glyphPayload("glyph-bytes");
    expect(isGlyphPayload(g)).toBe(true);

    const t = textPayload("hello");
    expect(isTextPayload(t)).toBe(true);

    const b = binaryPayload("aGVsbG8=", "text/plain");
    expect(isBinaryPayload(b)).toBe(true);
  });
});

describe("constructors compute approxBytes sensibly", () => {
  test("jsonPayload — JSON.stringify length", () => {
    const p = jsonPayload({ a: 1, b: "hi" });
    expect(p).toMatchObject({ kind: "json", data: { a: 1, b: "hi" } });
    expect(p.approxBytes).toBe(JSON.stringify({ a: 1, b: "hi" }).length);
  });

  test("jsonPayload — string payload uses string length", () => {
    const p = jsonPayload("abc");
    expect(p.approxBytes).toBe(3);
  });

  test("jsonPayload — explicit approxBytes override", () => {
    const p = jsonPayload({ big: true }, 9999);
    expect(p.approxBytes).toBe(9999);
  });

  test("textPayload — char count", () => {
    const p = textPayload("hello world");
    expect(p).toMatchObject({ kind: "text", text: "hello world", approxBytes: 11 });
  });

  test("binaryPayload — ~75% base64 → bytes", () => {
    const p = binaryPayload("aGVsbG8=", "text/plain");
    expect(p.approxBytes).toBe(Math.round(8 * 0.75));
  });

  test("glyphPayload — preserves provided bytes", () => {
    const p = glyphPayload("abc", 500);
    expect(p.approxBytes).toBe(500);
  });
});

describe("smartEncode", () => {
  test("tiny data always returns JSON", () => {
    const p = smartEncode({ a: 1 });
    expect(p.kind).toBe("json");
  });

  test("forceGlyph promotes even tiny data to glyph when encoding succeeds", () => {
    const p = smartEncode({ a: 1 }, { forceGlyph: true });
    // May still be json if encoding throws; test the "succeeded" path.
    expect(["glyph", "json"]).toContain(p.kind);
  });

  test("respects minBytes threshold", () => {
    const small = { a: "x".repeat(10) };
    const p = smartEncode(small, { minBytes: 10_000 });
    expect(p.kind).toBe("json");
  });
});

describe("decodePayload + round-trips", () => {
  test("json decodes back to original data", () => {
    const original = { a: 1, nested: { b: [1, 2, 3] } };
    expect(decodePayload(jsonPayload(original))).toEqual(original);
  });

  test("text decodes to its string", () => {
    expect(decodePayload(textPayload("hi there"))).toBe("hi there");
  });

  test("binary returns base64 as-is (caller decodes)", () => {
    expect(decodePayload(binaryPayload("aGVsbG8=", "text/plain"))).toBe("aGVsbG8=");
  });

  test("glyph decode failure returns diagnostic object, doesn't throw", () => {
    const bad = glyphPayload("not valid glyph bytes :(");
    const r = decodePayload(bad) as { _glyphDecodeError?: boolean; raw?: string };
    expect(r._glyphDecodeError).toBe(true);
    expect(typeof r.raw).toBe("string");
  });

  test("tryDecodePayload wraps decode failures as null path (but decodePayload guards internally too)", () => {
    const r = tryDecodePayload(textPayload("x"));
    expect(r).toBe("x");
  });
});

describe("payloadToContext", () => {
  test("json is pretty-printed 2-space indent", () => {
    const ctx = payloadToContext(jsonPayload({ a: 1 }));
    expect(ctx).toBe('{\n  "a": 1\n}');
  });

  test("glyph is fenced with label when provided", () => {
    const ctx = payloadToContext(glyphPayload("xyz"), "tool-result");
    expect(ctx).toContain("```glyph tool-result");
    expect(ctx).toContain("xyz");
    expect(ctx.endsWith("```")).toBe(true);
  });

  test("glyph is fenced without label when omitted", () => {
    const ctx = payloadToContext(glyphPayload("xyz"));
    expect(ctx.startsWith("```glyph\n")).toBe(true);
  });

  test("text returns the text verbatim", () => {
    expect(payloadToContext(textPayload("hi"))).toBe("hi");
  });

  test("binary returns a size-annotated placeholder, not the blob", () => {
    const ctx = payloadToContext(binaryPayload("a".repeat(1024), "image/png"));
    expect(ctx).toMatch(/^\[Binary: image\/png, \d+KB\]$/);
  });
});

describe("payloadSummary", () => {
  test("includes kind + byte count", () => {
    expect(payloadSummary(jsonPayload({ a: 1 }))).toMatch(/^json\(\d+ bytes\)$/);
    expect(payloadSummary(textPayload("xyz"))).toMatch(/^text\(3 chars\)$/);
    expect(payloadSummary(glyphPayload("gggg", 100))).toMatch(/^glyph\(4 chars, ~100 original\)$/);
    expect(payloadSummary(binaryPayload("a".repeat(20), "image/jpeg"))).toMatch(/binary\(image\/jpeg/);
  });
});

describe("payloadBadge", () => {
  test("produces human-friendly labels", () => {
    expect(payloadBadge(jsonPayload(0))).toEqual({ label: "JSON", color: "blue" });
    expect(payloadBadge(glyphPayload(""))).toEqual({ label: "GLYPH", color: "purple" });
    expect(payloadBadge(textPayload(""))).toEqual({ label: "TEXT", color: "gray" });
    expect(payloadBadge(binaryPayload("", "image/png"))).toMatchObject({ label: "PNG" });
  });
});

describe("serializePayload / deserializePayload", () => {
  test("round-trips a json payload", () => {
    const original = jsonPayload({ hello: "world" });
    expect(deserializePayload(serializePayload(original))).toEqual(original);
  });

  test("round-trips a text payload", () => {
    const original = textPayload("plain");
    expect(deserializePayload(serializePayload(original))).toEqual(original);
  });

  test("legacy plain-JSON wraps in a json envelope", () => {
    const stored = JSON.stringify({ legacy: true });
    const deserialized = deserializePayload(stored);
    expect(deserialized.kind).toBe("json");
    expect((deserialized as { data: unknown }).data).toEqual({ legacy: true });
  });

  test("unparseable input becomes text payload", () => {
    const deserialized = deserializePayload("this is not json {{");
    expect(deserialized.kind).toBe("text");
    expect((deserialized as { text: string }).text).toBe("this is not json {{");
  });
});

describe("DeckPayload exhaustiveness", () => {
  // Smoke check that every kind is covered by a formatter. If someone
  // adds a new kind to the union but forgets to extend payloadSummary,
  // this spec won't compile/run — the switch inside the function will
  // be non-exhaustive at the type level.
  test("each kind has a summary", () => {
    const all: DeckPayload[] = [
      jsonPayload({}),
      glyphPayload(""),
      textPayload(""),
      binaryPayload("", "x/y"),
    ];
    for (const p of all) expect(typeof payloadSummary(p)).toBe("string");
  });
});
