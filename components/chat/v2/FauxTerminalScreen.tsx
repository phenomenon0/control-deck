"use client";

/**
 * FauxTerminalScreen — a static, themeable stand-in for the live terminal.
 *
 * The live PTY/WebSocket can't run inside Storybook's browser-mode tests, so the
 * chrome (tabs, splits, status bar) is verified with this faux screen while the
 * real wterm lives behind the same TerminalScreenProps seam in LiveTerminalScreen.
 *
 * It paints into a `.cd-term-screen` surface using the same `--term-*` vars wterm
 * consumes (with deck-token fallbacks), so it reskins per theme exactly like the
 * real terminal will — and never shows the old hard-coded #0a0a0a.
 */

import React, { useRef, useState } from "react";
import type { TerminalProfile, TerminalScreenProps } from "./terminalTypes";
import "./terminal.css";

const MONO = { fontFamily: "var(--term-font-family, var(--font-mono))", fontSize: "var(--font-size-sm)" } as const;
const LAUNCH: ReadonlyArray<[TerminalProfile, string]> = [
  ["shell", "Shell"],
  ["claude", "Claude"],
  ["opencode", "OpenCode"],
];

const MOCK_LINES = [
  { prompt: true, text: "bun run dev" },
  { prompt: false, text: "▲ Next.js 16 — ready in 1.7s · http://localhost:3333" },
  { prompt: false, text: "  ✓ compiled /deck in 412ms" },
] as const;

function PromptLine({ children, caret }: { children?: React.ReactNode; caret?: boolean }) {
  return (
    <div className="whitespace-pre-wrap break-words">
      <span style={{ color: "rgb(var(--accent-rgb))" }}>jethro@deck</span>
      <span style={{ opacity: 0.8 }}> ~/dev/control-deck </span>
      <span style={{ color: "rgb(var(--accent-rgb))" }}>❯ </span>
      {children}
      {caret && <span className="cd-term-caret">▍</span>}
    </div>
  );
}

export function FauxTerminalScreen({ state, exitCode, errorText, onLaunch, onRestart }: TerminalScreenProps) {
  // Local-echo faux shell so the Storybook terminal is actually typeable (no PTY
  // in the browser — real execution happens in LiveTerminalScreen / the deck).
  const [entered, setEntered] = useState<string[]>([]);
  const [current, setCurrent] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    if (current.trim() === "clear") {
      setEntered([]);
    } else {
      setEntered((p) => [...p, current]);
    }
    setCurrent("");
  };

  return (
    <div
      className="cd-term-screen relative flex h-full min-h-0 flex-col overflow-auto px-3 py-2 leading-relaxed"
      style={{
        background: "var(--term-bg, var(--bg-inset, var(--bg)))",
        color: "var(--term-fg, var(--text-primary))",
        ...MONO,
      }}
      data-state={state}
      onClick={state === "running" ? () => inputRef.current?.focus() : undefined}
    >
      {state === "empty" ? (
        <div className="m-auto flex flex-col items-center gap-3 text-center">
          <span className="text-[var(--text-muted)]" style={MONO}>
            No session in this pane
          </span>
          <div className="flex items-center gap-2">
            {LAUNCH.map(([profile, label]) => (
              <button
                key={profile}
                type="button"
                onClick={() => onLaunch?.(profile)}
                className="rounded-[var(--radius-sm)] border px-3 py-1 transition-colors hover:bg-[var(--bg-tertiary)]"
                style={{ borderColor: "var(--border-subtle)", color: "var(--text-primary)", ...MONO }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      ) : state === "connecting" || state === "reset" ? (
        <div className="m-auto flex items-center gap-2 text-[var(--text-muted)]" style={MONO}>
          <span
            className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden="true"
          />
          {state === "reset" ? "restarting…" : "connecting…"}
        </div>
      ) : (
        <>
          {MOCK_LINES.map((line, i) =>
            line.prompt ? (
              <PromptLine key={i}>{line.text}</PromptLine>
            ) : (
              <div key={i} className="whitespace-pre-wrap break-words text-[var(--text-secondary)]">
                {line.text}
              </div>
            ),
          )}
          {state === "running" && (
            <>
              {entered.map((cmd, i) => (
                <PromptLine key={`e${i}`}>{cmd}</PromptLine>
              ))}
              {/* live, typeable prompt (local echo) */}
              <div className="flex items-center whitespace-pre-wrap break-words">
                <span style={{ color: "rgb(var(--accent-rgb))" }}>jethro@deck</span>
                <span style={{ opacity: 0.8 }}> ~/dev/control-deck </span>
                <span style={{ color: "rgb(var(--accent-rgb))" }}>❯ </span>
                <input
                  ref={inputRef}
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  spellCheck={false}
                  autoComplete="off"
                  aria-label="Terminal input"
                  className="cd-term-input min-w-0 flex-1"
                />
              </div>
            </>
          )}

          {state === "exited" && (
            <div className="mt-3 flex items-center gap-3" style={MONO}>
              <span style={{ color: "var(--text-muted)" }}>
                [process exited{typeof exitCode === "number" ? ` — code ${exitCode}` : ""}]
              </span>
              {onRestart && (
                <button
                  type="button"
                  onClick={onRestart}
                  className="rounded-[var(--radius-sm)] border px-2 py-0.5 transition-colors hover:bg-[var(--bg-tertiary)]"
                  style={{ borderColor: "var(--border-subtle)", color: "var(--text-primary)", ...MONO }}
                >
                  restart
                </button>
              )}
            </div>
          )}

          {state === "error" && (
            <div className="mt-3 flex items-center gap-3" style={MONO}>
              <span style={{ color: "var(--err, #f87171)" }}>{errorText ?? "Terminal error."}</span>
              {onRestart && (
                <button
                  type="button"
                  onClick={onRestart}
                  className="rounded-[var(--radius-sm)] border px-2 py-0.5 transition-colors hover:bg-[var(--bg-tertiary)]"
                  style={{ borderColor: "var(--border-subtle)", color: "var(--text-primary)", ...MONO }}
                >
                  retry
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default FauxTerminalScreen;
