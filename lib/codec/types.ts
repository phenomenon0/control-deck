/**
 * GLYPH Codec Types
 * 
 * DEPRECATED: Use DeckPayload from @/lib/agui/payload instead
 * This file re-exports for backward compatibility during migration
 */

// Re-export DeckPayload as EncodedPayload for backward compatibility
// TODO: Update all imports to use DeckPayload directly
export type { DeckPayload as EncodedPayload } from "@/lib/agui/payload";
export { 
  isDeckPayload as isEncodedPayload,
  jsonPayload as toJsonPayload,
  glyphPayload as toGlyphPayload,
} from "@/lib/agui/payload";

// =============================================================================
// Encoding Options (still canonical here)
// =============================================================================

/**
 * Options for GLYPH encoding
 */
export interface GlyphEncodeOptions {
  /** Enable auto-tabular detection for uniform object arrays (default: true) */
  autoTabular?: boolean;
  /** Minimum rows for tabular mode (default: 4) */
  minRows?: number;
  /** Add newlines/indent for readability (default: false) */
  pretty?: boolean;
}

/**
 * Default encoding options
 */
export const DEFAULT_ENCODE_OPTIONS: Required<GlyphEncodeOptions> = {
  autoTabular: true,
  minRows: 4,
  pretty: false,
};

// =============================================================================
// Smart Encode Result
// =============================================================================

/**
 * Result of smart encoding (dual-encode, pick shorter)
 */
export interface SmartEncodeResult {
  /** The GLYPH-encoded string */
  glyph: string;
  /** Original JSON byte size */
  jsonBytes: number;
  /** GLYPH byte size */
  glyphBytes: number;
  /** Whether tabular mode was used */
  usedTabular: boolean;
  /** Percentage savings vs JSON */
  savings: number;
}
