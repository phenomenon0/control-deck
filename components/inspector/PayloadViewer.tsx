"use client";

import React, { useState, useCallback, useMemo } from "react";
import { ChevronRight } from "lucide-react";
import type { DeckPayload } from "@/lib/agui/payload";

interface PayloadViewerProps {
  payload: DeckPayload;
  label?: string;
  defaultExpanded?: boolean;
  maxPreviewLines?: number;
}

// Inline the essential decoder for client-side use
// This is a simplified version that handles the most common cases

function decodeGlyphClient(glyph: string): unknown {
  const trimmed = glyph.trim();
  if (trimmed === "") return null;
  
  let pos = 0;
  
  function skipWhitespace() {
    while (pos < trimmed.length && " \t\r".includes(trimmed[pos])) pos++;
  }
  
  function peek(): string {
    skipWhitespace();
    return pos < trimmed.length ? trimmed[pos] : "";
  }
  
  function parseValue(): unknown {
    skipWhitespace();
    if (pos >= trimmed.length) return null;
    
    const ch = trimmed[pos];
    
    // Null
    if (ch === "∅" || trimmed.slice(pos, pos + 4) === "null") {
      pos += ch === "∅" ? 1 : 4;
      return null;
    }
    
    // Boolean
    if (ch === "t" || trimmed.slice(pos, pos + 4) === "true") {
      pos += ch === "t" ? 1 : 4;
      return true;
    }
    if (ch === "f" || trimmed.slice(pos, pos + 5) === "false") {
      pos += ch === "f" ? 1 : 5;
      return false;
    }
    
    // Quoted string
    if (ch === '"') {
      return parseQuotedString();
    }
    
    // Array
    if (ch === "[") {
      return parseArray();
    }
    
    // Struct or tabular
    if (ch === "@") {
      pos++;
      const next = peek();
      if (next === "[") {
        return parsePackedStruct();
      }
      if (trimmed.slice(pos, pos + 3) === "tab") {
        return parseTabular();
      }
      if (trimmed.slice(pos, pos + 3) === "end") {
        pos += 3;
        return null; // End marker
      }
      throw new Error(`Unexpected @ at position ${pos}`);
    }
    
    // Number or bare string
    return parseNumberOrBare();
  }
  
  function parseQuotedString(): string {
    pos++; // skip "
    let value = "";
    while (pos < trimmed.length) {
      const ch = trimmed[pos];
      if (ch === '"') {
        pos++;
        return value;
      }
      if (ch === "\\") {
        pos++;
        const escaped = trimmed[pos];
        switch (escaped) {
          case "n": value += "\n"; break;
          case "r": value += "\r"; break;
          case "t": value += "\t"; break;
          case "\\": value += "\\"; break;
          case '"': value += '"'; break;
          case "|": value += "|"; break;
          case "u":
            const hex = trimmed.slice(pos + 1, pos + 5);
            value += String.fromCharCode(parseInt(hex, 16));
            pos += 4;
            break;
          default: value += escaped;
        }
      } else {
        value += ch;
      }
      pos++;
    }
    throw new Error("Unterminated string");
  }
  
  function parseArray(): unknown[] {
    pos++; // skip [
    const items: unknown[] = [];
    while (true) {
      const ch = peek();
      if (ch === "]") {
        pos++;
        return items;
      }
      if (ch === "") throw new Error("Unexpected end in array");
      items.push(parseValue());
    }
  }
  
  function parsePackedStruct(): Record<string, unknown> {
    pos++; // skip [
    const keys: string[] = [];
    
    // Parse keys
    while (true) {
      const ch = peek();
      if (ch === "]") {
        pos++;
        break;
      }
      if (ch === '"') {
        keys.push(parseQuotedString());
      } else {
        keys.push(parseNumberOrBare() as string);
      }
    }
    
    // Expect (
    skipWhitespace();
    if (trimmed[pos] !== "(") throw new Error("Expected ( after keys");
    pos++;
    
    // Parse values
    const values: unknown[] = [];
    while (true) {
      const ch = peek();
      if (ch === ")") {
        pos++;
        break;
      }
      if (ch === "") throw new Error("Unexpected end in struct");
      values.push(parseValue());
    }
    
    const result: Record<string, unknown> = {};
    for (let i = 0; i < keys.length; i++) {
      result[keys[i]] = values[i];
    }
    return result;
  }
  
  function parseTabular(): Record<string, unknown>[] {
    pos += 3; // skip "tab"
    skipWhitespace();
    
    // Skip _ if present
    if (trimmed[pos] === "_") pos++;
    skipWhitespace();
    
    // Parse column names
    if (trimmed[pos] !== "[") throw new Error("Expected [ for columns");
    pos++;
    
    const columns: string[] = [];
    while (true) {
      const ch = peek();
      if (ch === "]") {
        pos++;
        break;
      }
      if (ch === '"') {
        columns.push(parseQuotedString());
      } else {
        columns.push(parseNumberOrBare() as string);
      }
    }
    
    // Skip newline
    skipWhitespace();
    if (trimmed[pos] === "\n") pos++;
    
    // Parse rows
    const rows: Record<string, unknown>[] = [];
    
    while (pos < trimmed.length) {
      skipWhitespace();
      
      // Check for @end
      if (trimmed[pos] === "@") {
        pos++;
        if (trimmed.slice(pos, pos + 3) === "end") {
          pos += 3;
          break;
        }
        throw new Error("Expected @end");
      }
      
      // Skip newlines
      if (trimmed[pos] === "\n") {
        pos++;
        continue;
      }
      
      // Parse row: |val|val|val|
      if (trimmed[pos] === "|") {
        pos++;
        const row: Record<string, unknown> = {};
        for (let i = 0; i < columns.length; i++) {
          const cellValue = parseCellValue();
          row[columns[i]] = cellValue;
          if (trimmed[pos] === "|") pos++;
        }
        rows.push(row);
        // Skip trailing newline
        if (trimmed[pos] === "\n") pos++;
      }
    }
    
    return rows;
  }
  
  function parseCellValue(): unknown {
    skipWhitespace();
    const ch = trimmed[pos];
    
    if (ch === "|" || ch === "\n") return null;
    if (ch === "@" || ch === "[") return parseValue();
    if (ch === '"') return parseQuotedString();
    if (ch === "∅") { pos++; return null; }
    if (ch === "t") { pos++; return true; }
    if (ch === "f") { pos++; return false; }
    
    return parseNumberOrBare();
  }
  
  function parseNumberOrBare(): string | number {
    let value = "";
    while (pos < trimmed.length) {
      const ch = trimmed[pos];
      if (" \t\r\n[]()@|\"".includes(ch)) break;
      value += ch;
      pos++;
    }
    
    // Check if number
    if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)) {
      return parseFloat(value);
    }
    
    return value;
  }
  
  try {
    return parseValue();
  } catch (err) {
    console.error("[PayloadViewer] GLYPH decode error:", err);
    return { _decodeError: String(err), raw: glyph };
  }
}

export function PayloadViewer({ 
  payload, 
  label,
  defaultExpanded = false,
  maxPreviewLines = 5,
}: PayloadViewerProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [decoded, setDecoded] = useState<Record<string, unknown> | unknown[] | string | number | boolean | null>(null);
  const [showDecoded, setShowDecoded] = useState(false);
  
  // Get badge info based on payload kind
  const badge = useMemo(() => {
    switch (payload.kind) {
      case "json": return { label: "JSON", color: "bg-blue-500/20 text-blue-400" };
      case "glyph": return { label: "GLYPH", color: "bg-purple-500/20 text-purple-400" };
      case "text": return { label: "TEXT", color: "bg-zinc-500/20 text-zinc-400" };
      case "binary": return { label: payload.mimeType.split("/")[1]?.toUpperCase() ?? "BIN", color: "bg-orange-500/20 text-orange-400" };
    }
  }, [payload]);
  
  // Get size info
  const sizeInfo = useMemo(() => {
    const bytes = payload.approxBytes ?? 0;
    if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    if (bytes > 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
  }, [payload]);
  
  // Get preview content
  const preview = useMemo(() => {
    switch (payload.kind) {
      case "json":
        const json = JSON.stringify(payload.data, null, 2);
        const lines = json.split("\n");
        if (lines.length > maxPreviewLines) {
          return lines.slice(0, maxPreviewLines).join("\n") + "\n...";
        }
        return json;
      
      case "glyph":
        const glyphLines = payload.glyph.split("\n");
        if (glyphLines.length > maxPreviewLines) {
          return glyphLines.slice(0, maxPreviewLines).join("\n") + "\n...";
        }
        return payload.glyph;
      
      case "text":
        if (payload.text.length > 500) {
          return payload.text.slice(0, 500) + "...";
        }
        return payload.text;
      
      case "binary":
        return `[Binary: ${payload.mimeType}]`;
    }
  }, [payload, maxPreviewLines]);
  
  // Full content (for expanded view)
  const fullContent = useMemo(() => {
    switch (payload.kind) {
      case "json":
        return JSON.stringify(payload.data, null, 2);
      case "glyph":
        return payload.glyph;
      case "text":
        return payload.text;
      case "binary":
        return `[Binary data: ${payload.mimeType}, ${sizeInfo}]`;
    }
  }, [payload, sizeInfo]);
  
  // Handle decode for GLYPH
  const handleDecode = useCallback(() => {
    if (payload.kind === "glyph" && decoded === null) {
      const result = decodeGlyphClient(payload.glyph);
      // Cast to the expected type (decoder returns JSON-compatible values)
      setDecoded(result as Record<string, unknown> | unknown[] | string | number | boolean | null);
    }
    setShowDecoded(true);
  }, [payload, decoded]);
  
  // Copy handlers
  const copyRaw = useCallback(() => {
    navigator.clipboard.writeText(fullContent);
  }, [fullContent]);
  
  const copyDecoded = useCallback(() => {
    if (decoded) {
      navigator.clipboard.writeText(JSON.stringify(decoded, null, 2));
    }
  }, [decoded]);
  
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] overflow-hidden">
      {/* Header */}
      <div 
        className="flex items-center justify-between px-3 py-2 bg-[var(--bg-tertiary)] cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          {/* Expand/collapse arrow */}
          <ChevronRight
            className={`w-4 h-4 text-[var(--text-muted)] transition-transform ${expanded ? "rotate-90" : ""}`}
          />
          
          {/* Label */}
          {label && <span className="text-sm text-[var(--text-primary)]">{label}</span>}
          
          {/* Badge */}
          <span className={`text-xs px-1.5 py-0.5 rounded ${badge.color}`}>
            {badge.label}
          </span>
          
          {/* Size */}
          <span className="text-xs text-[var(--text-muted)]">
            {sizeInfo}
          </span>
        </div>
        
        {/* Actions (don't propagate click) */}
        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
          {payload.kind === "glyph" && (
            <button
              onClick={handleDecode}
              className="text-xs px-2 py-1 rounded bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 transition-colors"
            >
              Decode
            </button>
          )}
          <button
            onClick={copyRaw}
            className="text-xs px-2 py-1 rounded bg-[var(--bg-primary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            Copy
          </button>
        </div>
      </div>
      
      {/* Content */}
      {expanded && (
        <div className="p-3">
          {/* Tab bar for GLYPH with decoded view */}
          {payload.kind === "glyph" && decoded && (
            <div className="flex gap-2 mb-2">
              <button
                onClick={() => setShowDecoded(false)}
                className={`text-xs px-2 py-1 rounded transition-colors ${
                  !showDecoded 
                    ? "bg-purple-500/30 text-purple-300" 
                    : "bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                GLYPH
              </button>
              <button
                onClick={() => setShowDecoded(true)}
                className={`text-xs px-2 py-1 rounded transition-colors ${
                  showDecoded 
                    ? "bg-blue-500/30 text-blue-300" 
                    : "bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                Decoded JSON
              </button>
              {showDecoded && (
                <button
                  onClick={copyDecoded}
                  className="text-xs px-2 py-1 rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors ml-auto"
                >
                  Copy JSON
                </button>
              )}
            </div>
          )}
          
          {/* Code block */}
          <pre className="text-xs font-mono text-[var(--text-secondary)] whitespace-pre-wrap break-words overflow-x-auto max-h-[400px] overflow-y-auto">
            {showDecoded && decoded 
              ? JSON.stringify(decoded, null, 2)
              : String(fullContent)
            }
          </pre>
          
          {/* Savings indicator for GLYPH */}
          {payload.kind === "glyph" && payload.approxBytes && (
            <div className="mt-2 text-xs text-[var(--text-muted)]">
              Compression: {payload.glyph.length} chars from ~{payload.approxBytes} bytes
              ({((1 - payload.glyph.length / payload.approxBytes) * 100).toFixed(1)}% savings)
            </div>
          )}
        </div>
      )}
      
      {/* Collapsed preview */}
      {!expanded && (
        <div className="px-3 py-2">
          <pre className="text-xs font-mono text-[var(--text-muted)] whitespace-pre-wrap break-words line-clamp-3">
            {preview}
          </pre>
        </div>
      )}
    </div>
  );
}

export default PayloadViewer;
