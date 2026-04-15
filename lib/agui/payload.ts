/**
 * DeckPayload - Canonical envelope for all structured data in Control Deck
 * 
 * This is THE SINGLE SOURCE OF TRUTH for any data that:
 * - Goes into/out of the LLM context
 * - Gets stored in the database (events, messages)
 * - Gets displayed in the inspector
 * 
 * Replaces the old EncodedPayload type from lib/codec/types.ts
 */

import { decodeGlyph, encodeGlyphSmart } from "@/lib/codec";

/**
 * Canonical envelope for structured payloads
 * 
 * - `json`: Standard JSON data (most common)
 * - `glyph`: GLYPH-encoded data (for large payloads, LLM context)
 * - `text`: Plain text (for unstructured content)
 * - `binary`: Base64-encoded binary (for files, images)
 * 
 * All variants include optional `approxBytes` for size tracking
 */
export type DeckPayload =
  | { kind: "json"; data: unknown; approxBytes?: number }
  | { kind: "glyph"; glyph: string; approxBytes?: number }
  | { kind: "text"; text: string; approxBytes?: number }
  | { kind: "binary"; base64: string; mimeType: string; approxBytes?: number };

export function isDeckPayload(value: unknown): value is DeckPayload {
  if (typeof value !== "object" || value === null) return false;
  
  const obj = value as Record<string, unknown>;
  
  switch (obj.kind) {
    case "json":
      return "data" in obj;
    case "glyph":
      return typeof obj.glyph === "string";
    case "text":
      return typeof obj.text === "string";
    case "binary":
      return typeof obj.base64 === "string" && typeof obj.mimeType === "string";
    default:
      return false;
  }
}

export function isJsonPayload(p: DeckPayload): p is { kind: "json"; data: unknown; approxBytes?: number } {
  return p.kind === "json";
}

export function isGlyphPayload(p: DeckPayload): p is { kind: "glyph"; glyph: string; approxBytes?: number } {
  return p.kind === "glyph";
}

export function isTextPayload(p: DeckPayload): p is { kind: "text"; text: string; approxBytes?: number } {
  return p.kind === "text";
}

export function isBinaryPayload(p: DeckPayload): p is { kind: "binary"; base64: string; mimeType: string; approxBytes?: number } {
  return p.kind === "binary";
}

/**
 * Create a JSON payload
 */
export function jsonPayload(data: unknown, approxBytes?: number): DeckPayload {
  const bytes = approxBytes ?? (typeof data === "string" ? data.length : JSON.stringify(data).length);
  return { kind: "json", data, approxBytes: bytes };
}

/**
 * Create a GLYPH payload
 */
export function glyphPayload(glyph: string, approxBytes?: number): DeckPayload {
  return { kind: "glyph", glyph, approxBytes };
}

/**
 * Create a text payload
 */
export function textPayload(text: string): DeckPayload {
  return { kind: "text", text, approxBytes: text.length };
}

/**
 * Create a binary payload
 */
export function binaryPayload(base64: string, mimeType: string): DeckPayload {
  return { kind: "binary", base64, mimeType, approxBytes: Math.round(base64.length * 0.75) };
}

/**
 * Configuration for smart encoding
 */
export interface SmartEncodeConfig {
  /** Minimum JSON bytes before considering GLYPH (default: 2000) */
  minBytes?: number;
  /** Minimum savings % required to use GLYPH (default: 10) */
  minSavings?: number;
  /** Force GLYPH encoding regardless of savings (default: false) */
  forceGlyph?: boolean;
}

const DEFAULT_SMART_CONFIG: Required<SmartEncodeConfig> = {
  minBytes: 2000,
  minSavings: 10,
  forceGlyph: false,
};

/**
 * Smart encode data - picks JSON or GLYPH based on size/savings
 * 
 * Use this for:
 * - Large tool results going back to LLM
 * - Search results, vector query results
 * - Any structured data that might benefit from compression
 */
export function smartEncode(data: unknown, config: SmartEncodeConfig = {}): DeckPayload {
  const cfg = { ...DEFAULT_SMART_CONFIG, ...config };
  
  // Get JSON representation
  const json = JSON.stringify(data);
  const jsonBytes = json.length;
  
  // Small payloads: just use JSON
  if (jsonBytes < cfg.minBytes && !cfg.forceGlyph) {
    return jsonPayload(data, jsonBytes);
  }
  
  // Try GLYPH encoding
  try {
    const result = encodeGlyphSmart(data);
    
    // Check if savings meet threshold
    if (result.savings >= cfg.minSavings || cfg.forceGlyph) {
      console.log(`[Payload] GLYPH: ${jsonBytes} → ${result.glyphBytes} bytes (${result.savings.toFixed(1)}% savings)`);
      return glyphPayload(result.glyph, jsonBytes);
    }
    
    // Savings too low, use JSON
    return jsonPayload(data, jsonBytes);
  } catch (err) {
    // Encoding failed, fall back to JSON
    console.warn("[Payload] GLYPH encoding failed, using JSON:", err);
    return jsonPayload(data, jsonBytes);
  }
}

/**
 * Decode a DeckPayload back to its raw value
 * 
 * - JSON: returns data as-is
 * - GLYPH: decodes and returns parsed object
 * - Text: returns string
 * - Binary: returns base64 string (caller handles decoding)
 */
export function decodePayload(payload: DeckPayload): unknown {
  switch (payload.kind) {
    case "json":
      return payload.data;
    
    case "glyph":
      try {
        return decodeGlyph(payload.glyph);
      } catch (err) {
        console.error("[Payload] GLYPH decode failed:", err);
        return { _glyphDecodeError: true, raw: payload.glyph };
      }
    
    case "text":
      return payload.text;
    
    case "binary":
      return payload.base64;
  }
}

/**
 * Try to decode, return null on failure
 */
export function tryDecodePayload(payload: DeckPayload): unknown | null {
  try {
    return decodePayload(payload);
  } catch {
    return null;
  }
}

/**
 * Convert payload to string for LLM context
 * JSON is stringified, GLYPH is wrapped in fences
 */
export function payloadToContext(payload: DeckPayload, label?: string): string {
  switch (payload.kind) {
    case "json":
      return JSON.stringify(payload.data, null, 2);
    
    case "glyph": {
      const header = label ? `\`\`\`glyph ${label}` : "```glyph";
      return `${header}\n${payload.glyph}\n\`\`\``;
    }
    
    case "text":
      return payload.text;
    
    case "binary":
      return `[Binary: ${payload.mimeType}, ${Math.round((payload.approxBytes ?? 0) / 1024)}KB]`;
  }
}

/**
 * Get a human-readable summary of payload for logging/display
 */
export function payloadSummary(payload: DeckPayload): string {
  const bytes = payload.approxBytes ?? 0;
  
  switch (payload.kind) {
    case "json":
      return `json(${bytes} bytes)`;
    case "glyph":
      return `glyph(${payload.glyph.length} chars, ~${bytes} original)`;
    case "text":
      return `text(${bytes} chars)`;
    case "binary":
      return `binary(${payload.mimeType}, ${bytes} bytes)`;
  }
}

/**
 * Get the kind badge for UI display
 */
export function payloadBadge(payload: DeckPayload): { label: string; color: string } {
  switch (payload.kind) {
    case "json":
      return { label: "JSON", color: "blue" };
    case "glyph":
      return { label: "GLYPH", color: "purple" };
    case "text":
      return { label: "TEXT", color: "gray" };
    case "binary":
      return { label: payload.mimeType.split("/")[1]?.toUpperCase() ?? "BIN", color: "orange" };
  }
}

/**
 * Serialize payload for database storage
 * Returns a JSON string that can be stored in TEXT column
 */
export function serializePayload(payload: DeckPayload): string {
  return JSON.stringify(payload);
}

/**
 * Deserialize payload from database
 * Handles legacy formats (plain JSON without envelope)
 */
export function deserializePayload(stored: string): DeckPayload {
  try {
    const parsed = JSON.parse(stored);
    
    // Check if it's already a DeckPayload
    if (isDeckPayload(parsed)) {
      return parsed;
    }
    
    // Legacy format: wrap in JSON payload
    return jsonPayload(parsed);
  } catch {
    // Parse failed: treat as text
    return textPayload(stored);
  }
}
