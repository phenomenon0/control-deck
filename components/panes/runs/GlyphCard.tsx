"use client";

import { useState } from "react";
import type { GlyphItem } from "./types";
import { formatTime } from "./types";

export function GlyphCard({ item }: { item: GlyphItem }) {
  const [showDecoded, setShowDecoded] = useState(false);

  const isGlyph = item.payload.kind === "glyph";
  const content = isGlyph
    ? (item.payload as { kind: "glyph"; glyph: string }).glyph
    : JSON.stringify(
        item.payload.kind === "json" ? (item.payload as { kind: "json"; data: unknown }).data : item.payload,
        null,
        2,
      );
  const approxBytes = item.payload.approxBytes ?? content.length;
  const savings = isGlyph && approxBytes > 0
    ? ((1 - content.length / approxBytes) * 100).toFixed(1)
    : "0";

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="rounded-[6px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2.5 bg-[rgba(255,255,255,0.04)] border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-[var(--text-primary)]">{item.toolName}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded ${
            item.type === "args" ? "bg-orange-500/20 text-orange-400" : "bg-green-500/20 text-green-400"
          }`}>
            {item.type === "args" ? "Input" : "Output"}
          </span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${
            isGlyph ? "bg-purple-500/30 text-purple-300" : "bg-blue-500/30 text-blue-300"
          }`}>
            {item.payload.kind.toUpperCase()}
          </span>
        </div>
        <span className="text-xs text-[var(--text-muted)]">{formatTime(item.timestamp)}</span>
      </div>

      <div className="flex items-center gap-4 px-3 py-2 border-b border-[var(--border)] bg-[rgba(255,255,255,0.04)]">
        <div className="flex items-center gap-1">
          <span className="text-xs text-[var(--text-muted)]">Size:</span>
          <span className={`text-xs font-mono ${isGlyph ? "text-purple-400" : "text-blue-400"}`}>
            {content.length} {isGlyph ? "chars" : "bytes"}
          </span>
        </div>
        {isGlyph && (
          <>
            <div className="flex items-center gap-1">
              <span className="text-xs text-[var(--text-muted)]">Original:</span>
              <span className="text-xs font-mono text-[var(--text-secondary)]">~{approxBytes} bytes</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-[var(--text-muted)]">Savings:</span>
              <span className={`text-xs font-mono ${parseFloat(savings) > 0 ? "text-green-400" : "text-[var(--text-secondary)]"}`}>
                {savings}%
              </span>
            </div>
          </>
        )}
      </div>

      <div className="p-3">
        {isGlyph && (
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
              Decoded
            </button>
            <button
              onClick={() => copyToClipboard(content)}
              className="text-xs px-2 py-1 rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors ml-auto"
            >
              Copy
            </button>
          </div>
        )}
        {!isGlyph && (
          <div className="flex justify-end mb-2">
            <button
              onClick={() => copyToClipboard(content)}
              className="text-xs px-2 py-1 rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              Copy
            </button>
          </div>
        )}

        <pre className="xcode-preview whitespace-pre-wrap break-words overflow-x-auto max-h-[200px] overflow-y-auto p-3">
          {content.length > 500 ? content.slice(0, 500) + "\n..." : content}
        </pre>
      </div>

      <div className="px-3 py-2 border-t border-[var(--border)] bg-[rgba(255,255,255,0.04)]">
        <code className="text-[10px] text-[var(--text-muted)]">Run: {item.runId.slice(0, 8)}...</code>
      </div>
    </div>
  );
}
