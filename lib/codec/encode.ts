/**
 * GLYPH Encoder — thin adapter over the official `cowrie-glyph` renderer.
 *
 * The private hand-rolled GLYPH-text encoder has been deleted. All text is
 * produced by cowrie-glyph's schema-free "loose" renderer
 * (`canonicalizeLooseWithOpts` over a `fromJsonLoose` GValue), which is the
 * official renderer for JSON-domain data and is governed by the GLYPH spec
 * (`docs/CANONICAL_FORMS.md`, SPEC-CANON.md). Glyph text is a renderer, never
 * hashed: identity lives on canonical JSON + fingerprint (see
 * `lib/agui/identity.ts`).
 *
 * Deliberate adapter configuration (all knobs are official LooseCanonOpts):
 * - `nullStyle: "symbol"` — null renders as `∅` (Go reference canon null;
 *   also what this codec historically emitted, so stored glyph text stays
 *   readable). The official JS default preset uses `_`; both spellings parse
 *   back identically.
 * - `autoTabular` / `minRows` map 1:1 onto the private options with the same
 *   defaults (true / 4). Tabular selection itself is official: any list of
 *   3+ maps with ≥ half shared keys is eligible, nested values are allowed in
 *   cells (the private codec required primitive-only cells with identical key
 *   sets).
 *
 * Rendered format (official loose):
 * - null: ∅  ·  bool: t / f  ·  int: bare digits  ·  float: shortest
 *   round-trip with Go exponent thresholds (e.g. `1e-07`, `1e+21`)
 * - string: bare iff ASCII identifier [A-Za-z_][A-Za-z0-9_]* outside the
 *   reserved list, else quoted
 * - array: `[elem1 elem2]`  ·  object: `{key=value key2=value2}` (keys
 *   sorted by code point, unlike the old positional `@[k1 k2](v1 v2)`)
 * - tabular: `@tab _ rows=N cols=M [cols]` … `|v1|v2|` … `@end`
 *
 * Behavior changes vs the private encoder (official wins; LLM-facing text
 * changing is INTENTIONAL):
 * - NaN/±Infinity now THROW (`fromJsonLoose` rejects non-finite numbers,
 *   matching the canonical-JSON profile). Callers that need a JSON fallback
 *   catch this (payload.ts smartEncode does).
 * - Values/keys that the official loose renderer emits bare but its own JS
 *   parser cannot re-read (`_`-leading identifiers, e.g. `_id`, `__proto__`)
 *   still encode to official text; decoding that text is an upstream JS
 *   parser gap (see decode.ts header).
 */

import { fromJsonLoose, canonicalizeLooseWithOpts } from "cowrie-glyph";

import {
  type GlyphEncodeOptions,
  type SmartEncodeResult,
  DEFAULT_ENCODE_OPTIONS,
} from "./types";

/**
 * Encode a value to GLYPH (official loose renderer).
 */
export function encodeGlyph(
  value: unknown,
  options?: GlyphEncodeOptions
): string {
  const opts = { ...DEFAULT_ENCODE_OPTIONS, ...options };
  const gv = fromJsonLoose(value);
  return canonicalizeLooseWithOpts(gv, {
    autoTabular: opts.autoTabular,
    minRows: opts.minRows,
    // ∅ is this codec's historical and the Go-reference null spelling.
    nullStyle: "symbol",
  });
}

/**
 * Smart encode: tries both tabular and non-tabular, picks shorter.
 * Only does dual-encode for payloads > 2KB JSON.
 */
export function encodeGlyphSmart(
  data: unknown,
  options?: GlyphEncodeOptions
): SmartEncodeResult {
  const json = JSON.stringify(data);
  const jsonBytes = json.length;

  const opts = { ...DEFAULT_ENCODE_OPTIONS, ...options };

  // Small payloads: just encode with auto-tabular
  if (jsonBytes < 2048) {
    const glyph = encodeGlyph(data, { ...opts, autoTabular: true });
    return {
      glyph,
      jsonBytes,
      glyphBytes: glyph.length,
      usedTabular: glyph.includes("@tab"),
      format: glyph.includes("@tab") ? "tabular" : "loose",
      savings: ((jsonBytes - glyph.length) / jsonBytes) * 100,
    };
  }

  // Large payloads: try both, pick shorter
  const withTab = encodeGlyph(data, { ...opts, autoTabular: true });
  const withoutTab = encodeGlyph(data, { ...opts, autoTabular: false });

  const glyph = withTab.length <= withoutTab.length ? withTab : withoutTab;

  return {
    glyph,
    jsonBytes,
    glyphBytes: glyph.length,
    usedTabular: glyph === withTab && withTab.includes("@tab"),
    format: glyph === withTab && withTab.includes("@tab") ? "tabular" : "loose",
    savings: ((jsonBytes - glyph.length) / jsonBytes) * 100,
  };
}

/**
 * Wrap GLYPH in fenced code block for LLM prompts
 */
export function wrapGlyphBlock(glyph: string, label?: string): string {
  const header = label ? `\`\`\`glyph ${label}` : "```glyph";
  return `${header}\n${glyph}\n\`\`\``;
}

/**
 * Primer block taught to the LLM so it can read GLYPH payloads that arrive
 * as tool results or catalog data. Kept short — the goal is recognition,
 * not full grammar memorization. Mirrors the official loose renderer
 * (cowrie-glyph canonicalizeLoose) byte-for-byte.
 */
export function glyphInstruction(): string {
  return [
    "# GLYPH payloads",
    "Some tool results and catalog blocks arrive GLYPH-encoded inside ```glyph fences```. GLYPH is a compact JSON-equivalent. Read it like JSON, not prose.",
    "",
    "Syntax you will see:",
    "- `{key=value key2=value2}` — an object (keys are sorted; nested values recurse, e.g. `{user={id=1 name=Bob}}`).",
    "- `[elem1 elem2]` — an array.",
    "- `@tab _ rows=N cols=M [col1 col2]\\n|v1|v2|\\n|v3|v4|\\n@end` — a table (array of objects with shared keys).",
    "- Bare values: strings unquoted when safe (ASCII identifiers), numbers as-is, `t`/`f` for booleans, and `∅` for null. Strings with spaces or special characters are quoted, e.g. `\"hello world\"`.",
    "",
    "Example:",
    "```glyph data",
    "@tab _ rows=2 cols=3 [enabled note title]",
    "|t|∅|\"Rust 1.79 release\"|",
    "|f|\"beta\"|\"Bun 1.1.17 notes\"|",
    "@end",
    "```",
    "↑ decodes to `[{title:\"Rust 1.79 release\", enabled:true, note:null}, {title:\"Bun 1.1.17 notes\", enabled:false, note:\"beta\"}]`.",
    "",
    "Treat GLYPH blocks as authoritative data. Do not ask the user to \"paste the JSON\" — the data is already there.",
  ].join("\n");
}
