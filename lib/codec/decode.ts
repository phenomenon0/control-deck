/**
 * GLYPH Decoder — thin adapter over the official `cowrie-glyph` parser.
 *
 * `decodeGlyph` delegates to cowrie-glyph's `parseLoose` (the official inverse
 * of the loose renderer) and maps the resulting GValue back to JSON with
 * `toJsonLoose`. The private hand-rolled tokenizer/parser has been deleted.
 *
 * Used for:
 * - UI inspectability (decode preview)
 * - Testing (round-trip verification)
 * - Developer tooling
 *
 * NOT used in LLM runtime (LLM reads GLYPH directly)
 *
 * Upstream gap (documented, NOT fixed here — the glyph repo must stay
 * untouched): cowrie-glyph's JS `parseLoose` lexes any token starting with
 * `_` as the NULL placeholder, so official loose text that the emitter writes
 * bare for `_`-leading identifiers (map keys or string values such as `_id`,
 * `__proto__`) cannot be parsed back — `decodeGlyph` throws and
 * `tryDecodeGlyph` returns null. The quoted official spelling (`"_id"`,
 * `{"__proto__"=f}`) parses fine. Control-deck therefore never silently
 * corrupts such text: decode fails loudly, exactly like the official package.
 * Go/Python loose surfaces accept `_`-leading bare keys, so this is a JS-only
 * parser quirk of the installed dist.
 */

import { parseLoose, toJsonLoose } from "cowrie-glyph";

/**
 * Decode GLYPH (official loose text) to a JSON-compatible value.
 *
 * @param glyph - GLYPH-encoded string
 * @returns Decoded value
 * @throws Error if parsing fails (including the `_`-leading-token upstream gap)
 */
export function decodeGlyph(glyph: string): unknown {
  const trimmed = glyph.trim();
  if (trimmed === "") {
    return null;
  }
  return toJsonLoose(parseLoose(trimmed));
}

/**
 * Try to decode GLYPH, return null on failure (for safe UI usage)
 */
export function tryDecodeGlyph(glyph: string): unknown | null {
  try {
    return decodeGlyph(glyph);
  } catch {
    return null;
  }
}

/**
 * Decode and return as pretty-printed JSON string (for UI preview)
 */
export function decodeGlyphToJson(glyph: string, indent = 2): string {
  const decoded = decodeGlyph(glyph);
  return JSON.stringify(decoded, null, indent);
}
