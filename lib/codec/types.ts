/**
 * GLYPH Codec Types
 */

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
