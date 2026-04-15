/**
 * GLYPH Encoder
 * Token-optimized text encoding for LLM contexts
 * 
 * Format:
 * - null: ∅
 * - bool: t / f
 * - number: bare (42, 3.14)
 * - string: bare if safe, else quoted ("hello world")
 * - array: [elem1 elem2 elem3]
 * - object: @[key1 key2](val1 val2)
 * - tabular: @tab _ [cols]\n|v1|v2|\n@end
 */

import {
  type GlyphEncodeOptions,
  type SmartEncodeResult,
  DEFAULT_ENCODE_OPTIONS,
} from "./types";

const MAX_DEPTH = 50;

/** Reserved words that must be quoted when used as string values */
const RESERVED_WORDS = new Set([
  "t", "f", "true", "false", "null", "none", "nil", "∅"
]);

/**
 * Check if character is ASCII letter
 */
function isLetter(c: number): boolean {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

/**
 * Check if character is ASCII digit
 */
function isDigit(c: number): boolean {
  return c >= 48 && c <= 57;
}

/**
 * Check if string can be represented as bare (unquoted) in GLYPH
 * Bare-safe if: starts with letter/underscore, contains only [a-zA-Z0-9_\-./]
 */
function isBareSafe(s: string): boolean {
  if (s.length === 0) return false;
  if (s.startsWith("@")) return false;
  if (RESERVED_WORDS.has(s)) return false;
  
  const first = s.charCodeAt(0);
  if (!isLetter(first) && first !== 95) return false; // _ = 95
  
  for (let i = 1; i < s.length; i++) {
    const c = s.charCodeAt(i);
    // a-z, A-Z, 0-9, _, -, ., /
    if (!isLetter(c) && !isDigit(c) && c !== 95 && c !== 45 && c !== 46 && c !== 47) {
      return false;
    }
  }
  return true;
}

/**
 * Quote a string with minimal escapes
 */
function quoteString(s: string): string {
  let result = '"';
  for (const ch of s) {
    switch (ch) {
      case "\\": result += "\\\\"; break;
      case '"': result += '\\"'; break;
      case "\n": result += "\\n"; break;
      case "\r": result += "\\r"; break;
      case "\t": result += "\\t"; break;
      default:
        if (ch.charCodeAt(0) < 0x20) {
          result += "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0");
        } else {
          result += ch;
        }
    }
  }
  return result + '"';
}

/**
 * Escape pipe characters in tabular cells
 */
function escapeTabularCell(s: string): string {
  return s.replace(/\|/g, "\\|");
}

/**
 * Check if a value is safe for tabular cell (primitive only)
 */
function isTabularSafeValue(val: unknown): boolean {
  if (val === null || val === undefined) return true;
  const t = typeof val;
  return t === "boolean" || t === "number" || t === "string";
}

/**
 * Check if an array qualifies for tabular encoding
 * Requirements:
 * - All elements are objects (not arrays)
 * - All elements have identical keys
 * - All values are primitives (no nested objects/arrays)
 */
function isTabularArray(arr: unknown[], minRows: number): boolean {
  if (arr.length < minRows) return false;
  
  const first = arr[0];
  if (typeof first !== "object" || first === null || Array.isArray(first)) {
    return false;
  }
  
  const keys = Object.keys(first).sort().join(",");
  
  for (const item of arr) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return false;
    }
    if (Object.keys(item).sort().join(",") !== keys) {
      return false;
    }
    if (!Object.values(item).every(isTabularSafeValue)) {
      return false;
    }
  }
  
  return true;
}

/**
 * Encode a value to GLYPH format
 */
export function encodeGlyph(
  value: unknown,
  options?: GlyphEncodeOptions
): string {
  const opts = { ...DEFAULT_ENCODE_OPTIONS, ...options };
  return emitValue(value, 0, opts);
}

/**
 * Emit a value as GLYPH
 */
function emitValue(
  value: unknown,
  depth: number,
  opts: Required<GlyphEncodeOptions>
): string {
  if (depth > MAX_DEPTH) {
    throw new Error("GLYPH encoding exceeded maximum depth");
  }
  
  // Null
  if (value === null || value === undefined) {
    return "∅";
  }
  
  // Boolean
  if (typeof value === "boolean") {
    return value ? "t" : "f";
  }
  
  // Number
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      // NaN, Infinity - quote as string
      return quoteString(String(value));
    }
    if (Number.isInteger(value)) {
      return String(value);
    }
    // Float: use shortest representation
    return String(value).replace(/e\+/g, "e");
  }
  
  // String
  if (typeof value === "string") {
    return isBareSafe(value) ? value : quoteString(value);
  }
  
  // Array
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    
    // Check for tabular encoding
    if (opts.autoTabular && isTabularArray(value, opts.minRows)) {
      return emitTabular(value as Record<string, unknown>[], depth, opts);
    }
    
    // Regular array
    const items = value.map(v => emitValue(v, depth + 1, opts));
    return "[" + items.join(" ") + "]";
  }
  
  // Object
  if (typeof value === "object") {
    return emitStruct(value as Record<string, unknown>, depth, opts);
  }
  
  // Fallback
  return quoteString(String(value));
}

/**
 * Emit an object as packed struct: @[key1 key2](val1 val2)
 */
function emitStruct(
  obj: Record<string, unknown>,
  depth: number,
  opts: Required<GlyphEncodeOptions>
): string {
  const keys = Object.keys(obj);
  if (keys.length === 0) return "@[]()";
  
  const quotedKeys = keys.map(k => isBareSafe(k) ? k : quoteString(k));
  const values = keys.map(k => emitValue(obj[k], depth + 1, opts));
  
  return "@[" + quotedKeys.join(" ") + "](" + values.join(" ") + ")";
}

/**
 * Emit an array of uniform objects as tabular:
 * @tab _ [col1 col2]
 * |v1|v2|
 * |v3|v4|
 * @end
 */
function emitTabular(
  arr: Record<string, unknown>[],
  depth: number,
  opts: Required<GlyphEncodeOptions>
): string {
  const keys = Object.keys(arr[0]).sort();
  const quotedKeys = keys.map(k => isBareSafe(k) ? k : quoteString(k));
  
  let result = "@tab _ [" + quotedKeys.join(" ") + "]\n";
  
  for (const row of arr) {
    const cells = keys.map(k => {
      const encoded = emitValue(row[k], depth + 1, opts);
      return escapeTabularCell(encoded);
    });
    result += "|" + cells.join("|") + "|\n";
  }
  
  result += "@end";
  return result;
}

/**
 * Smart encode: tries both tabular and non-tabular, picks shorter
 * Only does dual-encode for payloads > 2KB JSON
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
 * Create the one-liner instruction for GLYPH blocks
 */
export function glyphInstruction(): string {
  return 'When you see ```glyph blocks```, treat them as structured data equivalent to JSON.';
}
