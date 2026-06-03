"use client";

/**
 * LiveTerminalScreen — the deck-only screen: wraps wterm's <Terminal> + a live
 * usePaneSession socket for one pane. Satisfies the same visual contract as
 * FauxTerminalScreen but is never imported by browser-mode stories (no PTY there).
 *
 * It registers a small imperative handle (focus / sendKeys / readLastOutput) into
 * a container-owned registry keyed by paneId so the container can focus the
 * active split and route the workspace adapter's sendKeys/readLastOutput. Empty
 * panes reuse the themed FauxTerminalScreen launcher.
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Terminal } from "@wterm/react";

import type { TerminalSession } from "@/lib/terminal/types";
import type { TerminalProfile } from "./terminalTypes";
import { usePaneSession } from "./usePaneSession";
import { FauxTerminalScreen } from "./FauxTerminalScreen";
import { CD_TERM_SCREEN_CLASS } from "./terminalTheme";
import { classifyToken, tokenAtOffset } from "./terminalLinks";
import { openInThemedBrowser } from "@/lib/open-in-browser";
import "./terminal.css";

export interface PaneHandle {
  focus: () => void;
  sendKeys: (keys: string) => { delivered: boolean; reason?: string };
  readLastOutput: (chars?: number) => string;
}

export interface LiveTerminalScreenProps {
  paneId: string;
  session: TerminalSession | null;
  serviceOnline: boolean;
  cursors: React.MutableRefObject<Map<string, number>>;
  registry: React.MutableRefObject<Map<string, PaneHandle>>;
  onExit?: () => void;
  onLaunch?: (profile: TerminalProfile) => void;
  onRestart?: () => void;
}

const MONO = { fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" } as const;

/** POSIX single-quote a dropped path so spaces/specials survive paste. */
function shellQuote(path: string): string {
  if (path === "") return "''";
  if (/^[A-Za-z0-9_\-+=:,.\/@%]+$/.test(path)) return path;
  return `'${path.replace(/'/g, `'\\''`)}'`;
}

export function LiveTerminalScreen({
  paneId,
  session,
  serviceOnline,
  cursors,
  registry,
  onExit,
  onLaunch,
  onRestart,
}: LiveTerminalScreenProps) {
  const pane = usePaneSession(session, { serviceOnline, cursors, onExit });
  const [dropOver, setDropOver] = useState(false);
  const dragDepthRef = useRef(0);
  const screenRef = useRef<HTMLDivElement>(null);

  // Mount the terminal at the RIGHT size from the start, instead of a fixed
  // 36-row guess that autoResize then has to correct. On a split, this leaf
  // remounts fresh and the new pane is already at its final (smaller) size, so
  // measuring here gives the correct cols/rows immediately — avoiding the
  // mismeasure where the 36-row grid overflows a half-height pane and the first
  // line floats mid-pane with a blank band above it.
  const [initDims, setInitDims] = useState<{ cols: number; rows: number } | null>(null);
  useLayoutEffect(() => {
    if (initDims || !session) return;
    const el = screenRef.current;
    if (!el) return;
    const dims = measureGridDims(el);
    setInitDims(dims ?? { cols: 120, rows: 36 });
  }, [initDims, session]);

  // ⌘-click a URL/path in the output. wterm owns its spans + repaints them, so
  // we resolve the token under the cursor on demand (no overlay) via the caret
  // APIs rather than maintaining a pixel-aligned hotspot layer.
  const handleLinkClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!e.metaKey) return;
      const hit = caretTokenAtPoint(e.clientX, e.clientY);
      if (!hit) return;
      const { kind, value } = classifyToken(tokenAtOffset(hit.text, hit.offset));
      if (kind === "url") {
        e.preventDefault();
        e.stopPropagation();
        openInThemedBrowser(value);
      } else if (kind === "path") {
        e.preventDefault();
        e.stopPropagation();
        pane.sendInput(shellQuote(value) + " ");
        pane.focus();
      }
    },
    [pane],
  );

  // Expose focus/sendKeys/readLastOutput to the container for this pane.
  useEffect(() => {
    const map = registry.current;
    map.set(paneId, {
      focus: pane.focus,
      sendKeys: pane.sendKeys,
      readLastOutput: pane.readLastOutput,
    });
    return () => {
      map.delete(paneId);
    };
  }, [paneId, registry, pane.focus, pane.sendKeys, pane.readLastOutput]);

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragDepthRef.current = 0;
      setDropOver(false);
      const dt = event.dataTransfer;
      if (!dt) return;

      const paths: string[] = [];
      const resolver = typeof window !== "undefined" ? window.deck?.getFilePath : undefined;
      if (dt.files && dt.files.length > 0) {
        for (let i = 0; i < dt.files.length; i++) {
          const f = dt.files.item(i);
          if (!f) continue;
          const path = (resolver ? resolver(f) : null) ?? (f as File & { path?: string }).path ?? null;
          if (path) paths.push(path);
        }
      }
      if (paths.length === 0) {
        const uriList = dt.getData("text/uri-list");
        if (uriList) {
          for (const line of uriList.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) continue;
            try {
              const url = new URL(trimmed);
              if (url.protocol === "file:") paths.push(decodeURIComponent(url.pathname));
            } catch {
              /* ignore */
            }
          }
        }
      }

      let payload: string;
      if (paths.length > 0) payload = paths.map(shellQuote).join(" ") + " ";
      else {
        const text = dt.getData("text/plain");
        if (!text) return;
        payload = text;
      }
      pane.sendInput(payload);
      pane.focus();
    },
    [pane],
  );

  // Empty pane → themed launcher (reuses the faux screen's empty state).
  if (!session) {
    return <FauxTerminalScreen sessionId={null} state="empty" onLaunch={onLaunch} />;
  }

  return (
    <div
      ref={screenRef}
      className={`${CD_TERM_SCREEN_CLASS} relative flex h-full min-h-0 flex-col overflow-hidden`}
      data-hotkeys-ignore="true"
      data-state={pane.state}
      onClickCapture={handleLinkClick}
      onMouseMove={(e) => {
        // Cheap cmd-hover affordance — mutate cursor directly (no rerender).
        if (screenRef.current) screenRef.current.style.cursor = e.metaKey ? "pointer" : "";
      }}
      onMouseDownCapture={() => pane.focus()}
      onDragEnter={(e) => {
        if (!e.dataTransfer?.types?.length) return;
        const hasFile = e.dataTransfer.types.includes("Files") || e.dataTransfer.types.includes("text/uri-list");
        if (!hasFile) return;
        e.preventDefault();
        dragDepthRef.current += 1;
        setDropOver(true);
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setDropOver(false);
      }}
      onDrop={handleDrop}
    >
      {initDims && (
        <Terminal
          key={pane.sessionKey ?? "term"}
          ref={pane.ref}
          cols={initDims.cols}
          rows={initDims.rows}
          autoResize
          cursorBlink
          // Fill the flex screen. Without this the `.wterm` root is flex-grow:0
          // and sizes to its own content; flex-1 gives it the real pane height so
          // wterm's autoResize tracks subsequent drags/window resizes.
          className="min-h-0 min-w-0 flex-1"
          data-hotkeys-ignore="true"
          onReady={pane.onReady}
          onResize={pane.onResize}
          onData={pane.onData}
        />
      )}

      {dropOver && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center" style={{ background: "rgba(var(--accent-rgb), 0.08)" }}>
          <span style={{ ...MONO, color: "rgb(var(--accent-rgb))" }}>⇣ Drop to paste path</span>
        </div>
      )}

      {pane.state === "connecting" && (
        <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-2 text-[var(--text-muted)]" style={MONO}>
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
          connecting…
        </div>
      )}

      {(pane.state === "exited" || pane.state === "error") && (
        <div
          className="absolute inset-x-0 bottom-0 flex items-center gap-3 border-t px-3 py-1.5"
          style={{ ...MONO, background: "var(--bg-secondary)", borderColor: "var(--border-subtle)" }}
        >
          <span style={{ color: pane.state === "error" ? "var(--err, #f87171)" : "var(--text-muted)" }}>
            {pane.state === "error"
              ? pane.errorText ?? "Terminal error."
              : `process exited${typeof pane.exitCode === "number" ? ` — code ${pane.exitCode}` : ""}`}
          </span>
          {onRestart && (
            <button
              type="button"
              onClick={onRestart}
              className="rounded-[var(--radius-sm)] border px-2 py-0.5 transition-colors hover:bg-[var(--bg-tertiary)]"
              style={{ ...MONO, borderColor: "var(--border-subtle)", color: "var(--text-primary)" }}
            >
              {pane.state === "error" ? "retry" : "restart"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Measure the wterm cell grid for a screen container → the cols/rows that fill
 * it. Probes a real `.wterm > .term-grid > .term-row` so the cell inherits the
 * deck's terminal font (set via `.cd-term-screen .wterm`).
 */
function measureGridDims(screen: HTMLElement): { cols: number; rows: number } | null {
  const w = screen.clientWidth;
  const h = screen.clientHeight;
  if (w <= 0 || h <= 0) return null;
  const probe = document.createElement("div");
  probe.className = "wterm";
  probe.style.cssText = "position:absolute;visibility:hidden;left:0;top:0;padding:0";
  const grid = document.createElement("div");
  grid.className = "term-grid";
  const row = document.createElement("div");
  row.className = "term-row";
  const span = document.createElement("span");
  span.textContent = "W";
  row.appendChild(span);
  grid.appendChild(row);
  probe.appendChild(grid);
  screen.appendChild(probe);
  const charW = span.getBoundingClientRect().width;
  const rowH = row.getBoundingClientRect().height;
  probe.remove();
  if (charW <= 0 || rowH <= 0) return null;
  return { cols: Math.max(2, Math.floor(w / charW)), rows: Math.max(2, Math.floor(h / rowH)) };
}

/** Resolve the text node + offset under a screen point, across caret APIs. */
function caretTokenAtPoint(x: number, y: number): { text: string; offset: number } | null {
  if (typeof document === "undefined") return null;
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  let node: Node | null = null;
  let offset = 0;
  if (typeof doc.caretPositionFromPoint === "function") {
    const pos = doc.caretPositionFromPoint(x, y);
    if (pos) {
      node = pos.offsetNode;
      offset = pos.offset;
    }
  } else if (typeof doc.caretRangeFromPoint === "function") {
    const range = doc.caretRangeFromPoint(x, y);
    if (range) {
      node = range.startContainer;
      offset = range.startOffset;
    }
  }
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  return { text: node.textContent ?? "", offset };
}

export default LiveTerminalScreen;
