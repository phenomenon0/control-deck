/**
 * GLYPH Tool Call Parser
 * 
 * Parses tool calls from GLYPH format:
 * 
 * ```glyph
 * Tool{
 *   name = tool_name
 *   args = @[param1 param2](value1 value2)
 * }
 * ```
 * 
 * Also supports the compact inline form:
 * Tool{name=tool_name args=@[p1 p2](v1 v2)}
 */

import { decodeGlyph, tryDecodeGlyph } from "./decode";

// =============================================================================
// Types
// =============================================================================

export interface GlyphToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ParsedToolResult {
  tool: GlyphToolCall | null;
  /** Text before the tool call */
  before: string;
  /** Text after the tool call */
  after: string;
  /** The raw GLYPH tool block */
  raw: string;
}

// =============================================================================
// Regex Patterns
// =============================================================================

/**
 * Match Tool{...} blocks, including nested structures
 * Uses a simple state machine approach for balanced braces
 */
function extractToolBlocks(text: string): Array<{ start: number; end: number; content: string }> {
  const blocks: Array<{ start: number; end: number; content: string }> = [];
  
  // Find all Tool{ positions
  let searchPos = 0;
  while (true) {
    const toolPos = text.indexOf("Tool{", searchPos);
    if (toolPos === -1) break;
    
    // Find matching closing brace
    // Start AFTER "Tool{" - we're already inside, so depth starts at 1
    let depth = 1;
    let inString = false;
    let escape = false;
    let endPos = -1;
    
    for (let i = toolPos + 5; i < text.length; i++) {
      const ch = text[i];
      
      if (escape) {
        escape = false;
        continue;
      }
      
      if (ch === "\\") {
        escape = true;
        continue;
      }
      
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      
      if (inString) continue;
      
      if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) {
          endPos = i + 1;
          break;
        }
      }
    }
    
    if (endPos > toolPos) {
      blocks.push({
        start: toolPos,
        end: endPos,
        content: text.slice(toolPos, endPos),
      });
      searchPos = endPos;
    } else {
      // Malformed, skip past Tool{
      searchPos = toolPos + 5;
    }
  }
  
  return blocks;
}

/**
 * Parse the inner content of a Tool{...} block
 */
function parseToolContent(content: string): GlyphToolCall | null {
  // Remove Tool{ and }
  const inner = content.slice(5, -1).trim();
  
  // Parse as a GLYPH struct-like format
  // We need to extract name = VALUE and args = VALUE
  
  let name: string | null = null;
  let argsRaw: string | null = null;
  
  // Simple state machine to extract key=value pairs
  let pos = 0;
  while (pos < inner.length) {
    // Skip whitespace
    while (pos < inner.length && /\s/.test(inner[pos])) pos++;
    if (pos >= inner.length) break;
    
    // Read key (until = or whitespace)
    const keyStart = pos;
    while (pos < inner.length && !/[\s=]/.test(inner[pos])) pos++;
    const key = inner.slice(keyStart, pos).trim();
    
    // Skip whitespace and =
    while (pos < inner.length && /[\s=]/.test(inner[pos])) pos++;
    
    // Read value
    const value = readValue(inner, pos);
    if (value === null) break;
    
    pos = value.end;
    
    if (key === "name") {
      name = String(value.parsed);
    } else if (key === "args") {
      argsRaw = value.raw;
    }
  }
  
  if (!name) return null;
  
  // Parse args
  let args: Record<string, unknown> = {};
  if (argsRaw) {
    const parsed = tryDecodeGlyph(argsRaw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      args = parsed as Record<string, unknown>;
    }
  }
  
  return { name, args };
}

/**
 * Read a GLYPH value starting at pos
 */
function readValue(text: string, pos: number): { raw: string; parsed: unknown; end: number } | null {
  // Skip whitespace
  while (pos < text.length && /\s/.test(text[pos])) pos++;
  if (pos >= text.length) return null;
  
  const start = pos;
  const ch = text[pos];
  
  // Quoted string
  if (ch === '"') {
    pos++;
    while (pos < text.length) {
      if (text[pos] === "\\") {
        pos += 2;
        continue;
      }
      if (text[pos] === '"') {
        pos++;
        break;
      }
      pos++;
    }
    const raw = text.slice(start, pos);
    const parsed = tryDecodeGlyph(raw);
    return { raw, parsed, end: pos };
  }
  
  // Packed struct: @[...](...) 
  if (ch === "@" && text[pos + 1] === "[") {
    // Find matching ) after the (
    pos += 2;
    // Skip to ]
    while (pos < text.length && text[pos] !== "]") pos++;
    pos++; // skip ]
    // Skip to (
    while (pos < text.length && text[pos] !== "(") pos++;
    if (text[pos] === "(") {
      pos++;
      let depth = 1;
      let inString = false;
      let escape = false;
      while (pos < text.length && depth > 0) {
        const c = text[pos];
        if (escape) { escape = false; pos++; continue; }
        if (c === "\\") { escape = true; pos++; continue; }
        if (c === '"') { inString = !inString; pos++; continue; }
        if (inString) { pos++; continue; }
        if (c === "(") depth++;
        else if (c === ")") depth--;
        pos++;
      }
    }
    const raw = text.slice(start, pos);
    const parsed = tryDecodeGlyph(raw);
    return { raw, parsed, end: pos };
  }
  
  // Array: [...]
  if (ch === "[") {
    let depth = 1;
    pos++;
    let inString = false;
    let escape = false;
    while (pos < text.length && depth > 0) {
      const c = text[pos];
      if (escape) { escape = false; pos++; continue; }
      if (c === "\\") { escape = true; pos++; continue; }
      if (c === '"') { inString = !inString; pos++; continue; }
      if (inString) { pos++; continue; }
      if (c === "[") depth++;
      else if (c === "]") depth--;
      pos++;
    }
    const raw = text.slice(start, pos);
    const parsed = tryDecodeGlyph(raw);
    return { raw, parsed, end: pos };
  }
  
  // Nested struct: Name{...}
  if (ch === "{" || /[A-Z]/.test(ch)) {
    // Find the opening brace
    while (pos < text.length && text[pos] !== "{") pos++;
    if (text[pos] === "{") {
      pos++;
      let depth = 1;
      let inString = false;
      let escape = false;
      while (pos < text.length && depth > 0) {
        const c = text[pos];
        if (escape) { escape = false; pos++; continue; }
        if (c === "\\") { escape = true; pos++; continue; }
        if (c === '"') { inString = !inString; pos++; continue; }
        if (inString) { pos++; continue; }
        if (c === "{") depth++;
        else if (c === "}") depth--;
        pos++;
      }
    }
    const raw = text.slice(start, pos);
    const parsed = tryDecodeGlyph(raw);
    return { raw, parsed, end: pos };
  }
  
  // Bare value (identifier, number, etc) - read until whitespace or structural char
  while (pos < text.length && !/[\s{}\[\]()=,]/.test(text[pos])) pos++;
  const raw = text.slice(start, pos);
  const parsed = tryDecodeGlyph(raw);
  return { raw, parsed, end: pos };
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Extract the first GLYPH tool call from text
 */
export function parseGlyphToolCall(text: string): ParsedToolResult {
  const blocks = extractToolBlocks(text);
  
  if (blocks.length === 0) {
    return { tool: null, before: text, after: "", raw: "" };
  }
  
  const first = blocks[0];
  const tool = parseToolContent(first.content);
  
  return {
    tool,
    before: text.slice(0, first.start),
    after: text.slice(first.end),
    raw: first.content,
  };
}

/**
 * Extract all GLYPH tool calls from text
 */
export function parseAllGlyphToolCalls(text: string): GlyphToolCall[] {
  const blocks = extractToolBlocks(text);
  const tools: GlyphToolCall[] = [];
  
  for (const block of blocks) {
    const tool = parseToolContent(block.content);
    if (tool) {
      tools.push(tool);
    }
  }
  
  return tools;
}

/**
 * Check if text contains a GLYPH tool call
 */
export function hasGlyphToolCall(text: string): boolean {
  return text.includes("Tool{") && extractToolBlocks(text).length > 0;
}

/**
 * Extract first tool call from text (GLYPH format only)
 * Returns the tool or null if not found
 * 
 * This is the strict GLYPH-native parser - no JSON fallback.
 * Use parseGlyphToolCall() if you need before/after text context.
 */
export function parseTool(text: string): GlyphToolCall | null {
  const result = parseGlyphToolCall(text);
  return result.tool;
}
