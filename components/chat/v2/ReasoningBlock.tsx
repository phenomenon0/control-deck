"use client";

/**
 * ReasoningBlock (v2) — the agent's thinking trace from an AgentReasoningSegment.
 * Collapsible (expanded while streaming, collapsed once done), token-driven so it
 * reskins per theme. Mirrors the v1 ReasoningBubble but lean + prop-only.
 */

import { useState } from "react";
import { Brain, ChevronDown, ChevronRight } from "lucide-react";

export interface ReasoningBlockProps {
  content: string;
  isStreaming?: boolean;
  /** Default expand/collapse; while streaming it forces open. */
  defaultCollapsed?: boolean;
}

const MONO = { fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" } as const;

export function ReasoningBlock({ content, isStreaming = false, defaultCollapsed = true }: ReasoningBlockProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed && !isStreaming);
  const open = isStreaming || !collapsed;
  const tokens = Math.max(1, Math.round(content.length / 4));

  return (
    <div
      className="cd-reasoning rounded-[var(--radius-sm)] border"
      style={{ borderColor: "var(--border-subtle)", background: "var(--bg-secondary)" }}
    >
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)]"
        style={MONO}
      >
        <Brain size={13} />
        <span style={{ letterSpacing: "var(--tracking-label, 0.06em)" }}>
          {isStreaming ? "thinking…" : "reasoning"}
        </span>
        <span style={{ opacity: 0.6 }}>· ~{tokens} tok</span>
        <span className="ml-auto">{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
      </button>
      {open && (
        <div
          className="whitespace-pre-wrap px-3 pb-2.5 pt-0.5 text-[var(--text-secondary)]"
          style={{ fontFamily: "var(--font-sans)", fontSize: "var(--font-size-sm)", lineHeight: "var(--lh-body, 1.55)" }}
        >
          {content}
          {isStreaming && <span className="rt-caret">▮</span>}
        </div>
      )}
    </div>
  );
}

export default ReasoningBlock;
