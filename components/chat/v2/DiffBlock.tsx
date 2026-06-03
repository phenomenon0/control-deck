"use client";

/**
 * DiffBlock (v2) — a unified line diff for code the agent proposes, with optional
 * accept/reject. Uses the `diff` lib; token-driven; added/removed lines tinted
 * with --ok/--err. Part of "review work".
 */

import { useMemo } from "react";
import { diffLines } from "diff";
import { Check, X } from "lucide-react";

import { Button } from "./ui";

export interface DiffBlockProps {
  before: string;
  after: string;
  language?: string;
  fileName?: string;
  onAccept?: () => void;
  onReject?: () => void;
}

const MONO = { fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" } as const;

export function DiffBlock({ before, after, language, fileName, onAccept, onReject }: DiffBlockProps) {
  const parts = useMemo(() => diffLines(before, after), [before, after]);
  const added = parts.filter((p) => p.added).reduce((n, p) => n + (p.count ?? 0), 0);
  const removed = parts.filter((p) => p.removed).reduce((n, p) => n + (p.count ?? 0), 0);

  return (
    <div className="cd-diff overflow-hidden rounded-[var(--radius-sm)] border" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-inset, var(--bg))" }}>
      <div className="flex items-center gap-2 border-b px-2.5 py-1" style={{ borderColor: "var(--border-subtle)" }}>
        <span className="text-[var(--text-muted)]" style={MONO}>{fileName ?? language ?? "diff"}</span>
        <span style={{ ...MONO, color: "var(--ok, #34d399)" }}>+{added}</span>
        <span style={{ ...MONO, color: "var(--err, #f87171)" }}>-{removed}</span>
        {(onAccept || onReject) && (
          <span className="ml-auto flex items-center gap-1">
            {onReject && (
              <Button variant="outline" size="sm" onClick={onReject} aria-label="Reject diff" style={{ ...MONO }}>
                <X size={11} /> reject
              </Button>
            )}
            {onAccept && (
              <Button variant="accent" size="sm" onClick={onAccept} aria-label="Accept diff" style={{ ...MONO }}>
                <Check size={11} /> accept
              </Button>
            )}
          </span>
        )}
      </div>
      <pre className="overflow-x-auto py-1" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-sm)", lineHeight: 1.5 }}>
        {parts.map((part, pi) => {
          const lines = part.value.replace(/\n$/, "").split("\n");
          const sign = part.added ? "+" : part.removed ? "-" : " ";
          const bg = part.added
            ? "color-mix(in oklab, var(--ok, #34d399), transparent 86%)"
            : part.removed
              ? "color-mix(in oklab, var(--err, #f87171), transparent 86%)"
              : "transparent";
          const color = part.added ? "var(--ok, #34d399)" : part.removed ? "var(--err, #f87171)" : "var(--text-secondary)";
          return lines.map((ln, li) => (
            <div key={`${pi}-${li}`} className="px-2" style={{ background: bg }}>
              <span style={{ color, opacity: 0.7, userSelect: "none" }}>{sign} </span>
              <span className="text-[var(--text-primary)]">{ln}</span>
            </div>
          ));
        })}
      </pre>
    </div>
  );
}

export default DiffBlock;
