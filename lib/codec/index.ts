/**
 * GLYPH Codec
 * Token-optimized encoding for LLM contexts
 * 
 * Usage:
 * ```typescript
 * import { encodeGlyph, decodeGlyph, encodeGlyphSmart } from '@/lib/codec';
 * 
 * // Encode data
 * const glyph = encodeGlyph({ name: 'Alice', age: 30 });
 * // => "@[age name](30 Alice)"
 * 
 * // Decode back
 * const data = decodeGlyph(glyph);
 * // => { age: 30, name: "Alice" }
 * 
 * // Smart encode (picks shorter of tabular/non-tabular)
 * const result = encodeGlyphSmart(largeArray);
 * console.log(`Saved ${result.savings.toFixed(1)}%`);
 * ```
 */

// Types
export type {
  EncodedPayload,
  GlyphEncodeOptions,
  SmartEncodeResult,
} from "./types";

export {
  isEncodedPayload,
  toJsonPayload,
  toGlyphPayload,
  DEFAULT_ENCODE_OPTIONS,
} from "./types";

// Encoding
export {
  encodeGlyph,
  encodeGlyphSmart,
  wrapGlyphBlock,
  glyphInstruction,
} from "./encode";

// Decoding
export {
  decodeGlyph,
  tryDecodeGlyph,
  decodeGlyphToJson,
} from "./decode";
