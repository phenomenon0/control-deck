"use client";

/**
 * CodeBlock (v2) — a fenced code block with a language tag, copy, run-in-terminal
 * (shell langs), and open-in-canvas. Token-driven, flat terminal-ish surface.
 * Syntax highlighting is intentionally deferred (lazy shiki later) — copy/run/
 * canvas are the high-value affordances.
 */

import { useState } from "react";
import { Check, Copy, Play, SquarePen } from "lucide-react";

export interface CodeBlockProps {
  code: string;
  language?: string;
  onRun?: (code: string, language?: string) => void;
  onOpenCanvas?: (code: string, language?: string) => void;
}

const MONO = { fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" } as const;
const SHELL = new Set(["bash", "sh", "shell", "zsh"]);

export function CodeBlock({ code, language, onRun, onOpenCanvas }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const runnable = language ? SHELL.has(language.toLowerCase()) : false;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <div className="cd-code overflow-hidden rounded-[var(--radius-sm)] border" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-inset, var(--bg))" }}>
      <div className="flex items-center gap-2 border-b px-2 py-1" style={{ borderColor: "var(--border-subtle)" }}>
        <span className="text-[var(--text-muted)]" style={MONO}>{language ?? "text"}</span>
        <span className="ml-auto flex items-center gap-0.5">
          {onRun && runnable && (
            <Action label="Run in terminal" onClick={() => onRun(code, language)}>
              <Play size={12} /> run
            </Action>
          )}
          {onOpenCanvas && (
            <Action label="Open in canvas" onClick={() => onOpenCanvas(code, language)}>
              <SquarePen size={12} /> canvas
            </Action>
          )}
          <Action label="Copy code" onClick={copy}>
            {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "copied" : "copy"}
          </Action>
        </span>
      </div>
      <pre className="overflow-x-auto px-3 py-2 text-[var(--text-primary)]" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-sm)", lineHeight: 1.5 }}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function Action({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
      style={MONO}
    >
      {children}
    </button>
  );
}

export default CodeBlock;
