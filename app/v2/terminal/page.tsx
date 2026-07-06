"use client";

/* =============================================================================
   ATLAS VISUAL 2 — TERMINAL. Full-bleed Atlas chrome (session tab bar with
   glyph + close + new-tab, launcher cluster, bottom status strip) wrapped
   around the deck's REAL live PTY. The carved-well .screen mounts @wterm/react
   over the terminal-service WebSocket (port 4010) via the deck's own transport
   client — no reinvented PTY protocol. Reuses lib/hooks/useTerminalSessions and
   lib/terminal/client just like components/panes/TerminalPane, but rendered
   into Atlas paper-klein chrome. The wterm widget is themed light (`theme-light`
   + scoped .av2-term overrides) so it renders on the paper well, not a black box.
   Degrades to a clear "relay offline" message when the sidecar is down.
   ============================================================================= */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Terminal, useTerminal, type WTerm } from "@wterm/react";
import { useTerminalSessions } from "@/lib/hooks/useTerminalSessions";
import { getTerminalWebSocketUrl } from "@/lib/terminal/client";
import type {
  TerminalMetaMessage,
  TerminalProfile,
  TerminalServerMessage,
  TerminalSession,
  TerminalSessionStatus,
} from "@/lib/terminal/types";
import "./terminal-v2.css";

const P: Record<string, string> = {
  close: '<path d="M18 6L6 18M6 6l12 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>',
  split: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
};
const Ico = ({ name, sm }: { name: string; sm?: boolean }) => (
  <svg className={"ico" + (sm ? " ico--sm" : "")} viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: P[name] }} />
);

const PROFILE_GLYPH: Record<TerminalProfile, string> = { claude: "✦", opencode: "◆", shell: "❯" };
const PROFILE_LABEL: Record<TerminalProfile, string> = { claude: "Claude", opencode: "OpenCode", shell: "Shell" };

const LAST_SESSION_KEY = "deck:last-terminal-session";
const OUTPUT_BUFFER_MAX = 64_000;

type SocketState = "disconnected" | "connecting" | "connected" | "error";

interface SessionMetaState {
  cwd?: string;
  pid?: number | null;
  status?: TerminalSessionStatus;
  exitCode?: number | null;
  error?: string | null;
}

export default function TerminalV2Page() {
  const {
    sessions,
    health,
    loading,
    error,
    serviceOnline,
    refresh,
    createSession,
    deleteSession,
  } = useTerminalSessions();

  const { ref, write, focus } = useTerminal();
  const socketRef = useRef<WebSocket | null>(null);
  const terminalReadyRef = useRef(false);
  const pendingOutputRef = useRef<string[]>([]);
  const outputBufferRef = useRef("");
  // Per-session UTF-8 byte cursor → sent as `?since=` so the sidecar resumes
  // from the tail instead of replaying full history (which redraws alt-screens).
  const receivedBytesRef = useRef<Map<string, number>>(new Map());
  const byteEncoderRef = useRef<TextEncoder | null>(null);
  const activeSessionRef = useRef<TerminalSession | null>(null);

  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(LAST_SESSION_KEY);
  });
  const [socketState, setSocketState] = useState<SocketState>("disconnected");
  const [transportError, setTransportError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState<SessionMetaState>({});
  const [size, setSize] = useState<{ cols: number; rows: number }>({ cols: 120, rows: 36 });

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );
  useEffect(() => { activeSessionRef.current = activeSession; }, [activeSession]);
  const activeSessionKey = activeSession ? `${activeSession.id}:${activeSession.startedAt}` : null;

  const focusSoon = useCallback(() => {
    if (typeof window === "undefined") return;
    window.setTimeout(() => focus(), 0);
  }, [focus]);

  // Keep an active session selected as the list changes.
  useEffect(() => {
    if (activeSessionId && sessions.some((s) => s.id === activeSessionId)) return;
    setActiveSessionId(sessions.length > 0 ? sessions[0].id : null);
  }, [sessions, activeSessionId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (activeSessionId) window.localStorage.setItem(LAST_SESSION_KEY, activeSessionId);
    else window.localStorage.removeItem(LAST_SESSION_KEY);
  }, [activeSessionId]);

  // Reset the mount buffers + meta whenever we switch to a different session.
  useEffect(() => {
    terminalReadyRef.current = false;
    pendingOutputRef.current = [];
    const snapshot = activeSessionRef.current;
    setMeta(
      snapshot
        ? { cwd: snapshot.cwd, pid: snapshot.pid, status: snapshot.status, exitCode: snapshot.exitCode, error: snapshot.error }
        : {},
    );
  }, [activeSessionKey]);

  // Live PTY WebSocket — attach to the active session, stream output into wterm.
  useEffect(() => {
    if (!serviceOnline || !activeSessionId) {
      setSocketState("disconnected");
      setTransportError(null);
      socketRef.current?.close();
      socketRef.current = null;
      return;
    }

    let socket: WebSocket | null = null;
    let cancelled = false;
    setSocketState("connecting");
    setTransportError(null);

    (async () => {
      let wsUrl: string;
      try {
        const since = receivedBytesRef.current.get(activeSessionId) ?? 0;
        wsUrl = await getTerminalWebSocketUrl(activeSessionId, { since });
      } catch (err) {
        if (cancelled) return;
        setSocketState("error");
        setTransportError(err instanceof Error ? err.message : "Unable to resolve terminal WebSocket URL.");
        return;
      }
      if (cancelled) return;

      socket = new WebSocket(wsUrl);
      socketRef.current = socket;

      socket.addEventListener("open", () => setSocketState("connected"));

      socket.addEventListener("message", (event) => {
        let message: TerminalServerMessage;
        try {
          message = JSON.parse(String(event.data)) as TerminalServerMessage;
        } catch {
          return;
        }
        if (message.type === "output") {
          const next = outputBufferRef.current + message.data;
          outputBufferRef.current = next.length > OUTPUT_BUFFER_MAX ? next.slice(-OUTPUT_BUFFER_MAX) : next;

          if (!byteEncoderRef.current) byteEncoderRef.current = new TextEncoder();
          const bytes = byteEncoderRef.current.encode(message.data).length;
          const prev = receivedBytesRef.current.get(activeSessionId) ?? 0;
          receivedBytesRef.current.set(activeSessionId, prev + bytes);

          if (terminalReadyRef.current) write(message.data);
          else pendingOutputRef.current.push(message.data);
          return;
        }
        if (message.type === "reset") {
          // Sidecar couldn't honor our `?since=` cursor — clear xterm scrollback
          // so the replay that follows paints cleanly.
          outputBufferRef.current = "";
          receivedBytesRef.current.set(activeSessionId, 0);
          const clear = "\x1b[2J\x1b[H\x1b[3J";
          if (terminalReadyRef.current) write(clear);
          else pendingOutputRef.current.push(clear);
          return;
        }
        if (message.type === "meta") {
          const m = message as TerminalMetaMessage;
          setMeta((c) => ({
            ...c,
            cwd: "cwd" in m ? m.cwd : c.cwd,
            pid: "pid" in m ? m.pid : c.pid,
            status: "status" in m ? m.status : c.status,
            exitCode: "exitCode" in m ? m.exitCode : c.exitCode,
            error: "error" in m ? m.error : c.error,
          }));
          return;
        }
        if (message.type === "status") {
          setMeta((c) => ({ ...c, status: message.status }));
          return;
        }
        if (message.type === "exit") {
          setMeta((c) => ({ ...c, exitCode: message.exitCode }));
          void refresh();
        }
      });

      socket.addEventListener("error", () => {
        setSocketState("error");
        setTransportError("Unable to attach to the selected terminal session.");
      });

      socket.addEventListener("close", () => {
        if (socketRef.current === socket) {
          socketRef.current = null;
          setSocketState(serviceOnline ? "disconnected" : "error");
        }
      });
    })();

    return () => {
      cancelled = true;
      socket?.close();
    };
  }, [activeSessionId, serviceOnline, refresh, write]);

  const handleReady = (wt?: WTerm) => {
    // @wterm emits host responses (CPR ESC[row;colR after a prompt sends ESC[6n)
    // during its async render pass; that delay makes the response land at the
    // shell as visible typed text (^[[5;1R). Flush responses immediately after
    // each write instead. getResponse() is consuming, so no double-send.
    if (wt && !(wt as WTerm & { __deckImmediateResponses?: boolean }).__deckImmediateResponses) {
      const patched = wt as WTerm & { __deckImmediateResponses?: boolean };
      const originalWrite = wt.write.bind(wt);
      wt.write = (data: string | Uint8Array) => {
        originalWrite(data);
        const response = wt.bridge?.getResponse();
        if (response && socketRef.current?.readyState === WebSocket.OPEN) {
          socketRef.current.send(JSON.stringify({ type: "input", data: response }));
        }
      };
      patched.__deckImmediateResponses = true;
    }
    terminalReadyRef.current = true;
    for (const chunk of pendingOutputRef.current) write(chunk);
    pendingOutputRef.current = [];
    focusSoon();
  };

  const sendResize = (cols: number, rows: number) => {
    setSize({ cols, rows });
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "resize", cols, rows }));
    }
  };
  const sendInput = (data: string) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "input", data }));
    }
  };

  const handleLaunch = useCallback(
    async (profile: TerminalProfile) => {
      try {
        setActionError(null);
        setBusy(true);
        const session = await createSession({ profile });
        setActiveSessionId(session.id);
        focusSoon();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Unable to launch session.");
      } finally {
        setBusy(false);
      }
    },
    [createSession, focusSoon],
  );

  const handleClose = useCallback(
    async (sessionId: string) => {
      try {
        setActionError(null);
        setBusy(true);
        await deleteSession(sessionId);
        if (activeSessionId === sessionId) setActiveSessionId(null);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Unable to close session.");
      } finally {
        setBusy(false);
      }
    },
    [deleteSession, activeSessionId],
  );

  const detailPid = meta.pid ?? activeSession?.pid ?? null;
  const detailExit = meta.exitCode ?? activeSession?.exitCode ?? null;
  const noticeRaw = transportError || actionError || meta.error || error || null;
  const notice = noticeRaw === "Unauthorized."
    ? "token mismatch · relay is up but this browser session is not authenticated"
    : noticeRaw;
  const runningCount = health?.running ?? sessions.filter((s) => s.status === "running").length;

  const socketLabel =
    socketState === "connected" ? "connected"
      : socketState === "connecting" ? "connecting"
        : socketState === "error" ? "error"
          : serviceOnline ? "idle" : "offline";
  const socketTone =
    socketState === "connected" ? "ok" : socketState === "error" || !serviceOnline ? "err" : "";

  return (
    <div className="av2-term">
      {/* full-bleed chrome bar — session tabs + new-tab + launcher cluster */}
      <div className="bar">
        <span className="dots"><i /><i /><i /></span>
        <div className="tabs">
          {sessions.map((s) => (
            <span
              key={s.id}
              className={"wtab" + (s.id === activeSessionId ? " is-active" : "")}
              onClick={() => { setActiveSessionId(s.id); focusSoon(); }}
              role="tab"
              aria-selected={s.id === activeSessionId}
            >
              <span className={"wtab__glyph wtab__glyph--" + s.status}>{PROFILE_GLYPH[s.profile]}</span>
              <span className="wtab__name">{s.label ?? PROFILE_LABEL[s.profile]}</span>
              <button
                className="wtab__x"
                aria-label={`Close ${s.label ?? PROFILE_LABEL[s.profile]}`}
                onClick={(e) => { e.stopPropagation(); void handleClose(s.id); }}
                disabled={busy}
              >
                <Ico name="close" sm />
              </button>
            </span>
          ))}
          <button
            className="newtab"
            aria-label="New session"
            title="New shell"
            onClick={() => void handleLaunch("shell")}
            disabled={!serviceOnline || busy}
          >
            <Ico name="plus" sm />
          </button>
        </div>

        <span className="host">
          {health?.host ?? "127.0.0.1"}:{health?.port ?? 4010}<span className="sep">·</span>
          <span className="tag">{sessions.length} session{sessions.length === 1 ? "" : "s"}</span>
          <span className={"tag tag--status" + (serviceOnline ? " tag--positive" : "")}>
            {serviceOnline ? "live" : "offline"}
          </span>
        </span>

        <div className="launch">
          <button className="iconbtn" aria-label="Search scrollback"><Ico name="search" /></button>
          <button className="iconbtn" aria-label="Split pane"><Ico name="split" /></button>
          <button className="iconbtn" aria-label="Command launcher"><Ico name="grid" /></button>
        </div>
      </div>

      {/* carved well — live PTY, launcher, or offline relay message */}
      <div className="screen">
        {activeSession ? (
          <div className="termhost" onMouseDownCapture={focusSoon} onClick={focusSoon}>
            <Terminal
              key={activeSessionKey ?? "term"}
              ref={ref}
              className="av2-wterm"
              theme="light"
              cols={120}
              rows={36}
              autoResize
              cursorBlink
              onReady={handleReady}
              onResize={sendResize}
              onData={sendInput}
            />
          </div>
        ) : !serviceOnline ? (
          <div className="stage">
            <div className="stage__mark">▶_</div>
            <div className="stage__title">terminal relay offline</div>
            <div className="stage__body">
              start it with:
              <code className="stage__cmd">bun run terminal-service</code>
            </div>
            <button className="stage__btn" onClick={() => void refresh()} disabled={loading}>
              {loading ? "checking…" : "retry"}
            </button>
            {notice && <div className="stage__err">{notice}</div>}
          </div>
        ) : (
          <div className="stage">
            <div className="stage__mark">▶_</div>
            <div className="stage__title">no live session</div>
            <div className="stage__body">spawn a shell to drop into the PTY</div>
            <div className="stage__opts">
              <button className="stage__opt stage__opt--primary" onClick={() => void handleLaunch("shell")} disabled={busy}>
                <span className="stage__opt-glyph">❯</span>local shell
              </button>
              <button className="stage__opt" onClick={() => void handleLaunch("claude")} disabled={busy}>
                <span className="stage__opt-glyph">✦</span>Claude
              </button>
              <button className="stage__opt" onClick={() => void handleLaunch("opencode")} disabled={busy}>
                <span className="stage__opt-glyph">◆</span>OpenCode
              </button>
            </div>
            {notice && <div className="stage__err">{notice}</div>}
          </div>
        )}
      </div>

      {/* status strip — live socket / process telemetry */}
      <div className="statusbar">
        <span className={"st st--accent" + (socketTone ? " st--" + socketTone : "")}>{socketLabel}</span>
        <span className="st">utf-8</span>
        <span className="st">{size.cols}×{size.rows}</span>
        <span className="sp" />
        {activeSession && <span className="st">{activeSession.label ?? PROFILE_LABEL[activeSession.profile]}</span>}
        <span className="st">{sessions.length} · {runningCount} live</span>
        {detailPid != null && <span className="st">pid {detailPid}</span>}
        {detailExit != null && <span className={"st" + (detailExit === 0 ? " st--ok" : " st--err")}>exit {detailExit}</span>}
      </div>
    </div>
  );
}
