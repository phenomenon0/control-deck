import fc from "fast-check";
import { describe, expect, test } from "bun:test";
import {
  binaryPayload,
  deserializePayload,
  glyphPayload,
  jsonPayload,
  serializePayload,
  textPayload,
  isDeckPayload,
  decodePayload,
  tryDecodePayload,
  type DeckPayload,
} from "./payload";
import { wrapPayload } from "./events";

// Arbitraries ───────────────────────────────────────────────────────

const jsonValueArb: fc.Arbitrary<unknown> = fc.jsonValue();

const textPayloadArb: fc.Arbitrary<DeckPayload> = fc.string().map((t) => textPayload(t));
const jsonPayloadArb: fc.Arbitrary<DeckPayload> = jsonValueArb.map((v) => jsonPayload(v));
const binaryPayloadArb: fc.Arbitrary<DeckPayload> = fc.tuple(
  fc.base64String(),
  fc.constantFrom("image/png", "image/jpeg", "application/pdf", "audio/mp3"),
).map(([b64, mime]) => binaryPayload(b64, mime));
const glyphPayloadArb: fc.Arbitrary<DeckPayload> = fc.string().map((g) => glyphPayload(g));

const anyPayloadArb = fc.oneof(jsonPayloadArb, textPayloadArb, binaryPayloadArb, glyphPayloadArb);

// Properties ────────────────────────────────────────────────────────

describe("DeckPayload properties", () => {
  test("serialize → deserialize round-trip preserves kind + payload fields", () => {
    // JSON.stringify drops `approxBytes: undefined`, so strict deep
    // equality fails for payloads constructed without a size hint.
    // The invariant we actually care about is: kind + the primary
    // payload field (data/glyph/text/base64) survive unchanged.
    fc.assert(
      fc.property(anyPayloadArb, (payload) => {
        const restored = deserializePayload(serializePayload(payload));
        expect(restored.kind).toBe(payload.kind);
        switch (payload.kind) {
          case "json":
            expect((restored as { data: unknown }).data).toEqual(payload.data);
            break;
          case "glyph":
            expect((restored as { glyph: string }).glyph).toBe(payload.glyph);
            break;
          case "text":
            expect((restored as { text: string }).text).toBe(payload.text);
            break;
          case "binary":
            expect((restored as { base64: string; mimeType: string }).base64).toBe(payload.base64);
            expect((restored as { mimeType: string }).mimeType).toBe(payload.mimeType);
            break;
        }
      }),
      { numRuns: 200 },
    );
  });

  test("isDeckPayload is true for every constructed payload", () => {
    fc.assert(
      fc.property(anyPayloadArb, (p) => {
        expect(isDeckPayload(p)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  test("wrapPayload is idempotent: wrap(wrap(x)) deep-equals wrap(x)", () => {
    fc.assert(
      fc.property(jsonValueArb, (v) => {
        const once = wrapPayload(v);
        const twice = wrapPayload(once);
        expect(twice).toEqual(once);
      }),
      { numRuns: 100 },
    );
  });

  test("wrapPayload on an already-wrapped payload returns same reference (pass-through)", () => {
    fc.assert(
      fc.property(jsonPayloadArb, (p) => {
        expect(wrapPayload(p)).toBe(p);
      }),
      { numRuns: 50 },
    );
  });

  test("jsonPayload → decode round-trip preserves JSON-compatible data", () => {
    fc.assert(
      fc.property(jsonValueArb, (v) => {
        const payload = jsonPayload(v);
        expect(decodePayload(payload)).toEqual(v);
      }),
      { numRuns: 100 },
    );
  });

  test("textPayload decode returns the exact string", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(decodePayload(textPayload(s))).toBe(s);
      }),
      { numRuns: 50 },
    );
  });

  test("tryDecodePayload never throws for any valid constructed payload", () => {
    fc.assert(
      fc.property(anyPayloadArb, (p) => {
        expect(() => tryDecodePayload(p)).not.toThrow();
      }),
      { numRuns: 100 },
    );
  });

  test("deserialize of a JSON.stringify(anything) never throws", () => {
    fc.assert(
      fc.property(jsonValueArb, (v) => {
        const stored = JSON.stringify(v);
        expect(() => deserializePayload(stored)).not.toThrow();
      }),
      { numRuns: 100 },
    );
  });
});

describe("DeckPayload invariants — legacy handling", () => {
  test("plain-JSON deserialize produces a json envelope with the same data", () => {
    fc.assert(
      fc.property(jsonValueArb, (v) => {
        const stored = JSON.stringify(v);
        const restored = deserializePayload(stored);
        // If the raw value IS a valid DeckPayload by shape, deserialize
        // recognizes it as such and returns it directly; otherwise wrap.
        if (isDeckPayload(v)) {
          expect(restored).toEqual(v as DeckPayload);
        } else {
          expect(restored.kind).toBe("json");
          expect((restored as { data: unknown }).data).toEqual(v);
        }
      }),
      { numRuns: 100 },
    );
  });

  test("totally unparseable string becomes text payload", () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => {
          try { JSON.parse(s); return false; }
          catch { return true; }
        }),
        (garbage) => {
          const restored = deserializePayload(garbage);
          expect(restored.kind).toBe("text");
          expect((restored as { text: string }).text).toBe(garbage);
        },
      ),
      { numRuns: 50 },
    );
  });
});
