import fc from "fast-check";
import { describe, expect, test } from "bun:test";
import { KEYSYMS, MODIFIERS, parseKeySpec } from "./keysym";

const knownModifiers = Object.keys(MODIFIERS);
const knownKeysyms = Object.keys(KEYSYMS);

// ── arbitraries ────────────────────────────────────────────────────

/** Any single printable ASCII character that is NOT '+' and NOT ' '. */
const safeSingleChar = fc
  .integer({ min: 0x21, max: 0x7e })
  .filter((cp) => cp !== 0x2b)
  .map((cp) => String.fromCharCode(cp));

const modifierToken = fc.constantFrom(...knownModifiers);
const keysymToken = fc.constantFrom(...knownKeysyms);

/** Random case transformer for case-insensitivity tests. */
const randomlyCased = (s: string) =>
  fc.func(fc.boolean()).map((toUpper) =>
    s.split("").map((ch, i) => (toUpper(ch, i) ? ch.toUpperCase() : ch.toLowerCase())).join(""),
  );

// ── properties ─────────────────────────────────────────────────────

describe("parseKeySpec — idempotence + invariants", () => {
  test("single printable char always maps to its codepoint with no modifiers", () => {
    fc.assert(
      fc.property(safeSingleChar, (ch) => {
        const parsed = parseKeySpec(ch);
        expect(parsed.modifiers).toEqual([]);
        expect(parsed.primary).toBe(ch.codePointAt(0)!);
      }),
      { numRuns: 200 },
    );
  });

  test("keysym names are case-insensitive", () => {
    fc.assert(
      fc.property(
        keysymToken.chain((name) => randomlyCased(name).map((cased) => ({ name, cased }))),
        ({ name, cased }) => {
          const parsed = parseKeySpec(cased);
          expect(parsed.primary).toBe(KEYSYMS[name]);
        },
      ),
      { numRuns: 100 },
    );
  });

  test("modifier combos preserve order of appearance", () => {
    fc.assert(
      fc.property(
        fc.array(modifierToken, { minLength: 1, maxLength: 4 }),
        keysymToken,
        (mods, primary) => {
          const spec = [...mods, primary].join("+");
          const parsed = parseKeySpec(spec);
          // The parsed modifiers should match the keysym codes for `mods`
          // in order.
          const expectedModCodes = mods.map((m) => MODIFIERS[m]);
          expect(parsed.modifiers).toEqual(expectedModCodes);
          expect(parsed.primary).toBe(KEYSYMS[primary]);
        },
      ),
      { numRuns: 150 },
    );
  });

  test("unknown modifier token is silently dropped, primary still resolves", () => {
    // Generate a token that is NOT a known modifier.
    const unknownModifier = fc.string({ minLength: 1, maxLength: 10 })
      .filter((s) => !knownModifiers.includes(s.toLowerCase()) && !s.includes("+") && !!s.trim());

    fc.assert(
      fc.property(unknownModifier, safeSingleChar, (unknown, ch) => {
        const parsed = parseKeySpec(`${unknown}+${ch}`);
        // Primary is the char; unknown modifier filtered out.
        expect(parsed.primary).toBe(ch.codePointAt(0)!);
        expect(parsed.modifiers).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });

  test("empty spec always throws 'empty key spec'", () => {
    fc.assert(
      fc.property(fc.constantFrom("", "   ", "\t"), (spec) => {
        expect(() => parseKeySpec(spec)).toThrow(/empty key spec/);
      }),
      { numRuns: 10 },
    );
  });

  test("primary keysym codepoint is always within valid ranges", () => {
    // All output primaries should be either printable ASCII (Unicode
    // codepoint) or X11 keysym space (0xff00-0xffff).
    fc.assert(
      fc.property(
        fc.oneof(safeSingleChar, keysymToken),
        (spec) => {
          const parsed = parseKeySpec(spec);
          const valid =
            (parsed.primary >= 0x20 && parsed.primary <= 0x7e)
            || (parsed.primary >= 0xff00 && parsed.primary <= 0xffff)
            || parsed.primary === 0x0020;
          expect(valid).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
