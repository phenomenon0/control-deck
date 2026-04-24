"use client";

/**
 * useTerminalAgui — client bridge that streams scraped terminal output
 * into Control Deck's AG-UI fabric for agent CLI sessions.
 *
 * Scope: `claude` and `opencode` profiles. Each session lifetime maps to
 * one AG-UI run (`threadId = terminal:<sessionId>`, fresh `runId` on each
 * `start()`). Text chunks are stripped of ANSI escapes and forwarded as
 * `TextMessageContent` deltas via `/api/terminal/agui`.
 *
 * Lossy by design — we do not attempt to parse claude's TUI for
 * tool-call / thinking segments. A later pass can opt a dedicated
 * stream-json child process into that, without changing this surface.
 */

import { useCallback, useEffect, useRef } from "react";
import type { TerminalProfile } from "@/lib/terminal/types";

const SUPPORTED: ReadonlySet<TerminalProfile> = new Set<TerminalProfile>(["claude", "opencode"]);

const FLUSH_INTERVAL_MS = 400;
const FLUSH_MAX_CHARS = 2_048;

/**
 * Strip ANSI escape sequences (CSI / OSC / SS2 / SS3 / other escape
 * commands) plus bare control chars other than tabs and newlines.
 * We keep this generous — if in doubt, we let text through. The goal
 * is a readable transcript, not lossless reproduction.
 */
const ANSI_RE =
  /\x1b\][^\x07]*\x07|\x1b[PX^_][^\x1b]*\x1b\\|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[@-_]/g;
const BARE_CTRL_RE = /[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]/g;

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "").replace(BARE_CTRL_RE, "");
}

interface SessionState {
  runId: string;
  messageId: string;
  pending: string;
  flushTimer: ReturnType<typeof setTimeout> | null;
  closed: boolean;
}

export interface TerminalAguiBridge {
  /** Start a new run for the given session. Idempotent per sessionId. */
  start: (opts: { sessionId: string; profile: TerminalProfile; label?: string | null; cwd?: string | null }) => void;
  /** Feed a raw output chunk (includes ANSI). Filters by supported profile. */
  emit: (sessionId: string, profile: TerminalProfile | undefined, raw: string) => void;
  /** End the run with optional exit code. */
  end: (sessionId: string, exitCode?: number | null) => void;
}

function genId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

export function useTerminalAgui(): TerminalAguiBridge {
  const sessions = useRef<Map<string, SessionState>>(new Map());

  const post = useCallback((body: unknown) => {
    // Fire-and-forget — scraping should not block the terminal UI.
    void fetch("/api/terminal/agui", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {
      // Swallow. The terminal continues to work even when the bridge fails.
    });
  }, []);

  const flush = useCallback(
    (sessionId: string) => {
      const state = sessions.current.get(sessionId);
      if (!state || state.closed) return;
      if (state.flushTimer) {
        clearTimeout(state.flushTimer);
        state.flushTimer = null;
      }
      const delta = state.pending;
      state.pending = "";
      if (!delta) return;
      post({
        kind: "text",
        sessionId,
        runId: state.runId,
        messageId: state.messageId,
        delta,
      });
    },
    [post],
  );

  const start = useCallback<TerminalAguiBridge["start"]>(
    ({ sessionId, profile, label, cwd }) => {
      if (!SUPPORTED.has(profile)) return;
      const existing = sessions.current.get(sessionId);
      // If a previous run was open but never closed (rare — component
      // unmount races with a restart), end it before starting a new one.
      if (existing && !existing.closed) {
        if (existing.flushTimer) clearTimeout(existing.flushTimer);
        post({
          kind: "end",
          sessionId,
          runId: existing.runId,
          messageId: existing.messageId,
        });
      }
      const state: SessionState = {
        runId: genId(),
        messageId: genId(),
        pending: "",
        flushTimer: null,
        closed: false,
      };
      sessions.current.set(sessionId, state);
      post({
        kind: "start",
        sessionId,
        profile,
        runId: state.runId,
        messageId: state.messageId,
        label: label ?? null,
        cwd: cwd ?? null,
      });
    },
    [post],
  );

  const emit = useCallback<TerminalAguiBridge["emit"]>(
    (sessionId, profile, raw) => {
      if (profile === undefined || !SUPPORTED.has(profile)) return;
      const state = sessions.current.get(sessionId);
      if (!state || state.closed) return;
      const clean = stripAnsi(raw);
      if (!clean) return;
      state.pending += clean;
      if (state.pending.length >= FLUSH_MAX_CHARS) {
        flush(sessionId);
        return;
      }
      if (!state.flushTimer) {
        state.flushTimer = setTimeout(() => flush(sessionId), FLUSH_INTERVAL_MS);
      }
    },
    [flush],
  );

  const end = useCallback<TerminalAguiBridge["end"]>(
    (sessionId, exitCode) => {
      const state = sessions.current.get(sessionId);
      if (!state || state.closed) return;
      if (state.flushTimer) {
        clearTimeout(state.flushTimer);
        state.flushTimer = null;
      }
      // Drain any final pending chunk before closing the message.
      if (state.pending) {
        post({
          kind: "text",
          sessionId,
          runId: state.runId,
          messageId: state.messageId,
          delta: state.pending,
        });
        state.pending = "";
      }
      state.closed = true;
      post({
        kind: "end",
        sessionId,
        runId: state.runId,
        messageId: state.messageId,
        exitCode: exitCode ?? null,
      });
    },
    [post],
  );

  // On unmount, best-effort close every open run so we don't leave
  // dangling entries in the Runs pane.
  useEffect(() => {
    const map = sessions.current;
    return () => {
      map.forEach((state, sessionId) => {
        if (state.closed) return;
        if (state.flushTimer) clearTimeout(state.flushTimer);
        // Use navigator.sendBeacon when available for better unload reliability.
        const payload = JSON.stringify({
          kind: "end",
          sessionId,
          runId: state.runId,
          messageId: state.messageId,
        });
        if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
          const blob = new Blob([payload], { type: "application/json" });
          navigator.sendBeacon("/api/terminal/agui", blob);
        } else {
          void fetch("/api/terminal/agui", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
            keepalive: true,
          }).catch(() => {});
        }
      });
    };
  }, []);

  return { start, emit, end };
}

export const __TEST__ = { stripAnsi };
