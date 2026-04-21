"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Terminal, useTerminal } from "@wterm/react";
import { Icon } from "@/components/warp/Icons";
import { useShortcut } from "@/lib/hooks/useShortcuts";
import { useTerminalSessions } from "@/lib/hooks/useTerminalSessions";
import { getTerminalWebSocketUrl } from "@/lib/terminal/client";
import type {
  TerminalMetaMessage,
  TerminalProfile,
  TerminalServerMessage,
  TerminalSession,
  TerminalSessionStatus,
} from "@/lib/terminal/types";

const LAST_SESSION_KEY = "deck:last-terminal-session";

type SocketState = "disconnected" | "connecting" | "connected" | "error";
type StatusFilter = "all" | "running" | "exited" | "error";

interface SessionMetaState {
  cwd?: string;
  pid?: number | null;
  label?: string;
  profile?: TerminalSession["profile"];
  status?: TerminalSessionStatus;
  exitCode?: number | null;
  error?: string | null;
}

const PROFILE_LABEL: Record<TerminalProfile, string> = {
  claude: "Claude",
  opencode: "OpenCode",
  shell: "Shell",
};

const KBD_NEW_SHELL = "⌥N";
const KBD_CLOSE = "⌥W";
const KBD_RESTART = "⌥⇧R";

export function TerminalPane() {
  const {
    sessions,
    health,
    loading,
    error,
    serviceOnline,
    refresh,
    createSession,
    restartSession,
    killSession,
    deleteSession,
  } = useTerminalSessions();
  const { ref, write, focus } = useTerminal();
  const socketRef = useRef<WebSocket | null>(null);
  const terminalReadyRef = useRef(false);
  const pendingOutputRef = useRef<string[]>([]);

  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(LAST_SESSION_KEY);
  });
  const [socketState, setSocketState] = useState<SocketState>("disconnected");
  const [transportError, setTransportError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [meta, setMeta] = useState<SessionMetaState>({});
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const focusTerminalSoon = useCallback(
    (delay = 0) => {
      if (typeof window === "undefined") return;
      window.setTimeout(() => focus(), delay);
    },
    [focus],
  );

  // ── Derived ────────────────────────────────────────────────────────────
  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );
  const activeSessionKey = activeSession
    ? `${activeSession.id}:${activeSession.startedAt}`
    : null;

  const runningCount =
    health?.running ?? sessions.filter((s) => s.status === "running").length;
  const staleCount = sessions.filter(
    (s) => s.status === "exited" || s.status === "error",
  ).length;
  const errorCount = sessions.filter((s) => s.status === "error").length;

  const visibleSessions = useMemo(() => {
    if (statusFilter === "all") return sessions;
    return sessions.filter((s) => s.status === statusFilter);
  }, [sessions, statusFilter]);

  const statusCounts = useMemo(
    () => ({
      all: sessions.length,
      running: sessions.filter((s) => s.status === "running").length,
      exited: sessions.filter((s) => s.status === "exited").length,
      error: errorCount,
    }),
    [sessions, errorCount],
  );

  useEffect(() => {
    if (activeSessionId && sessions.some((s) => s.id === activeSessionId)) return;
    if (sessions.length > 0) {
      setActiveSessionId(sessions[0].id);
      return;
    }
    setActiveSessionId(null);
  }, [sessions, activeSessionId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (activeSessionId) {
      window.localStorage.setItem(LAST_SESSION_KEY, activeSessionId);
    } else {
      window.localStorage.removeItem(LAST_SESSION_KEY);
    }
  }, [activeSessionId]);

  useEffect(() => {
    terminalReadyRef.current = false;
    pendingOutputRef.current = [];
    setMeta(
      activeSession
        ? {
            cwd: activeSession.cwd,
            pid: activeSession.pid,
            label: activeSession.label,
            profile: activeSession.profile,
            status: activeSession.status,
            exitCode: activeSession.exitCode,
            error: activeSession.error,
          }
        : {},
    );
  }, [activeSessionKey]);

  useEffect(() => {
    if (!activeSessionKey || socketState !== "connected") return;
    focusTerminalSoon(0);
  }, [activeSessionKey, socketState, focusTerminalSoon]);

  useEffect(() => {
    if (!serviceOnline || !activeSessionId) {
      setSocketState("disconnected");
      setTransportError(null);
      socketRef.current?.close();
      socketRef.current = null;
      return;
    }
    const socket = new WebSocket(getTerminalWebSocketUrl(activeSessionId));
    socketRef.current = socket;
    setSocketState("connecting");
    setTransportError(null);

    socket.addEventListener("open", () => setSocketState("connected"));

    socket.addEventListener("message", (event) => {
      let message: TerminalServerMessage;
      try {
        message = JSON.parse(String(event.data)) as TerminalServerMessage;
      } catch {
        return;
      }
      if (message.type === "output") {
        if (terminalReadyRef.current) write(message.data);
        else pendingOutputRef.current.push(message.data);
        return;
      }
      if (message.type === "meta") {
        const nextMeta = message as TerminalMetaMessage;
        setMeta((current) => ({
          ...current,
          cwd: "cwd" in nextMeta ? nextMeta.cwd : current.cwd,
          pid: "pid" in nextMeta ? nextMeta.pid : current.pid,
          label: "label" in nextMeta ? nextMeta.label : current.label,
          profile: "profile" in nextMeta ? nextMeta.profile : current.profile,
          status: "status" in nextMeta ? nextMeta.status : current.status,
          exitCode: "exitCode" in nextMeta ? nextMeta.exitCode : current.exitCode,
          error: "error" in nextMeta ? nextMeta.error : current.error,
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

    return () => socket.close();
  }, [activeSessionId, refresh, serviceOnline, write]);

  // ── Actions ────────────────────────────────────────────────────────────
  const handleLaunch = useCallback(
    async (profile: TerminalProfile) => {
      try {
        setActionError(null);
        setBusyAction(`launch:${profile}`);
        const session = await createSession({ profile });
        setActiveSessionId(session.id);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Unable to launch session.");
      } finally {
        setBusyAction(null);
      }
    },
    [createSession],
  );

  const handleRestart = useCallback(async () => {
    if (!activeSession) return;
    try {
      setActionError(null);
      setBusyAction("restart");
      const session = await restartSession(activeSession.id);
      setActiveSessionId(session.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Unable to restart.");
    } finally {
      setBusyAction(null);
    }
  }, [activeSession, restartSession]);

  const handleKill = useCallback(async () => {
    if (!activeSession) return;
    try {
      setActionError(null);
      setBusyAction("kill");
      await killSession(activeSession.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Unable to stop session.");
    } finally {
      setBusyAction(null);
    }
  }, [activeSession, killSession]);

  const handleDelete = useCallback(async () => {
    if (!activeSession) return;
    try {
      setActionError(null);
      setBusyAction("delete");
      const deletedId = activeSession.id;
      await deleteSession(activeSession.id);
      if (activeSessionId === deletedId) setActiveSessionId(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Unable to remove session.");
    } finally {
      setBusyAction(null);
    }
  }, [activeSession, activeSessionId, deleteSession]);

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      try {
        setActionError(null);
        setBusyAction(`delete:${sessionId}`);
        await deleteSession(sessionId);
        if (activeSessionId === sessionId) setActiveSessionId(null);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Unable to remove session.");
      } finally {
        setBusyAction(null);
      }
    },
    [activeSessionId, deleteSession],
  );

  const handleClearExited = useCallback(async () => {
    const stale = sessions.filter(
      (s) => s.status === "exited" || s.status === "error",
    );
    if (stale.length === 0) return;
    try {
      setActionError(null);
      setBusyAction("clear-exited");
      await Promise.all(stale.map((s) => deleteSession(s.id)));
      if (stale.some((s) => s.id === activeSessionId)) setActiveSessionId(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Unable to clear.");
    } finally {
      setBusyAction(null);
    }
  }, [activeSessionId, deleteSession, sessions]);

  const handleCopyDirectory = useCallback(async () => {
    const cwd = meta.cwd ?? activeSession?.cwd;
    if (!cwd || typeof navigator === "undefined" || !navigator.clipboard) {
      setActionError("Clipboard access is unavailable.");
      return;
    }
    try {
      setActionError(null);
      await navigator.clipboard.writeText(cwd);
    } catch {
      setActionError("Unable to copy the current path.");
    }
  }, [activeSession, meta.cwd]);

  const handleTerminalReady = () => {
    terminalReadyRef.current = true;
    for (const chunk of pendingOutputRef.current) write(chunk);
    pendingOutputRef.current = [];
    focusTerminalSoon(0);
  };

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      setActiveSessionId(sessionId);
      focusTerminalSoon(0);
    },
    [focusTerminalSoon],
  );

  const sendResize = (cols: number, rows: number) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "resize", cols, rows }));
    }
  };
  const sendInput = (data: string) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "input", data }));
    }
  };

  // ── Keyboard shortcuts ─────────────────────────────────────────────────
  useShortcut("alt+n", () => void handleLaunch("shell"), {
    when: "no-input",
    label: "Terminal: new shell",
  });
  useShortcut(
    "alt+w",
    () => {
      if (activeSession) void handleDelete();
    },
    { when: "no-input", label: "Terminal: close session" },
  );
  useShortcut(
    "alt+shift+r",
    () => {
      if (activeSession) void handleRestart();
    },
    { when: "no-input", label: "Terminal: restart session" },
  );

  const selectByIndex = useCallback(
    (index: number) => {
      const session = sessions[index];
      if (session) handleSelectSession(session.id);
    },
    [sessions, handleSelectSession],
  );
  useShortcut("alt+1", () => selectByIndex(0), { when: "no-input", label: "Terminal: session 1" });
  useShortcut("alt+2", () => selectByIndex(1), { when: "no-input", label: "Terminal: session 2" });
  useShortcut("alt+3", () => selectByIndex(2), { when: "no-input", label: "Terminal: session 3" });
  useShortcut("alt+4", () => selectByIndex(3), { when: "no-input", label: "Terminal: session 4" });
  useShortcut("alt+5", () => selectByIndex(4), { when: "no-input", label: "Terminal: session 5" });
  useShortcut("alt+6", () => selectByIndex(5), { when: "no-input", label: "Terminal: session 6" });
  useShortcut("alt+7", () => selectByIndex(6), { when: "no-input", label: "Terminal: session 7" });
  useShortcut("alt+8", () => selectByIndex(7), { when: "no-input", label: "Terminal: session 8" });
  useShortcut("alt+9", () => selectByIndex(8), { when: "no-input", label: "Terminal: session 9" });

  const detailStatus = meta.status ?? activeSession?.status ?? null;
  const detailCwd = meta.cwd ?? activeSession?.cwd ?? null;
  const detailPid = meta.pid ?? activeSession?.pid ?? null;
  const activeCanStop = detailStatus === "running" || detailStatus === "starting";
  const errorNotice = transportError || actionError || meta.error || null;
  const activeLabel = meta.label ?? activeSession?.label ?? null;

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="tp-stage">
      {/* ─── header ─────────────────────────────────────────────────── */}
      <header className="tp-header">
        <div>
          <div className="tp-eyebrow">Console</div>
          <h1 className="tp-title">Terminal</h1>
          <p className="tp-lede">
            Persistent PTYs for Claude, OpenCode, and shell work — every shell becomes
            a pinned thread with its own cwd, pid, and history.
          </p>
        </div>
        <div className="tp-header-actions">
          {activeSession && (
            <button
              type="button"
              className="tp-pill-ghost"
              onClick={() => void handleRestart()}
              disabled={busyAction !== null}
              title={`Restart (${KBD_RESTART})`}
            >
              Restart
            </button>
          )}
          <button
            type="button"
            className="tp-pill-ghost"
            onClick={() => void handleLaunch("claude")}
            disabled={!serviceOnline || busyAction !== null}
          >
            Claude
          </button>
          <button
            type="button"
            className="tp-pill-ghost"
            onClick={() => void handleLaunch("opencode")}
            disabled={!serviceOnline || busyAction !== null}
          >
            OpenCode
          </button>
          <button
            type="button"
            className="tp-pill"
            onClick={() => void handleLaunch("shell")}
            disabled={!serviceOnline || busyAction !== null}
            title={`New shell (${KBD_NEW_SHELL})`}
          >
            New shell
            <span className="tp-pill-kbd">{KBD_NEW_SHELL}</span>
          </button>
        </div>
      </header>

      {/* ─── meters ─────────────────────────────────────────────────── */}
      <section className="tp-meters">
        <div className="tp-meter">
          <div className="tp-meter-label">Shells</div>
          <div className="tp-meter-value">{sessions.length}</div>
          <div className="tp-meter-trend">
            {staleCount > 0 ? `${staleCount} exited` : loading ? "syncing…" : "—"}
          </div>
        </div>
        <div className="tp-meter">
          <div className="tp-meter-label">Running</div>
          <div className="tp-meter-value">{runningCount}</div>
          <div
            className={`tp-meter-trend${runningCount > 0 ? " tp-meter-trend--good" : ""}`}
          >
            {runningCount > 0 ? "live" : "idle"}
          </div>
        </div>
        <div className="tp-meter">
          <div className="tp-meter-label">Issues</div>
          <div className="tp-meter-value">{errorCount}</div>
          <div
            className={`tp-meter-trend${errorCount > 0 ? " tp-meter-trend--bad" : " tp-meter-trend--good"}`}
          >
            {errorCount > 0 ? "attention" : "clean"}
          </div>
        </div>
        <div className="tp-meter">
          <div className="tp-meter-label">Service</div>
          <div className="tp-meter-value tp-meter-value--text">
            {serviceOnline ? "online" : "offline"}
          </div>
          <div
            className={`tp-meter-trend${serviceOnline ? " tp-meter-trend--good" : " tp-meter-trend--bad"}`}
          >
            {health?.host ?? "127.0.0.1"}:{health?.port ?? 4010}
          </div>
        </div>
      </section>

      {/* ─── filters ────────────────────────────────────────────────── */}
      <div className="tp-filterbar">
        {(["all", "running", "exited", "error"] as const).map((f) => (
          <button
            key={f}
            type="button"
            className={`tp-filter-pill${statusFilter === f ? " tp-filter-pill--on" : ""}`}
            onClick={() => setStatusFilter(f)}
          >
            {f[0].toUpperCase() + f.slice(1)}
            <span className="tp-filter-count">{statusCounts[f]}</span>
          </button>
        ))}
        {staleCount > 0 && (
          <button
            type="button"
            className="tp-filterbar-link"
            onClick={() => void handleClearExited()}
            disabled={busyAction !== null}
          >
            Clear {staleCount} exited
          </button>
        )}
      </div>

      {/* ─── split: list + viewport ─────────────────────────────────── */}
      <div className="tp-split">
        {/* ─── list ─────────────────────────────────────────────── */}
        <div className="tp-list-wrap">
          <div className="tp-list-head">
            <span>Shell</span>
            <span>Seen</span>
          </div>
          {visibleSessions.length === 0 ? (
            <div className="tp-list-empty">
              {sessions.length === 0
                ? "No shells yet — launch one above."
                : `No ${statusFilter} shells.`}
            </div>
          ) : (
            <div className="tp-list">
              {visibleSessions.map((session) => {
                const isActive = session.id === activeSessionId;
                const globalIndex = sessions.indexOf(session);
                const canStop =
                  session.status === "running" || session.status === "starting";
                return (
                  <div
                    key={session.id}
                    className={`tp-row${isActive ? " tp-row--on" : ""}`}
                  >
                    <button
                      type="button"
                      className="tp-row-main"
                      onClick={() => handleSelectSession(session.id)}
                      title={`${PROFILE_LABEL[session.profile]} — ${session.cwd}`}
                    >
                      <span className="tp-row-label-wrap">
                        <span className={`tp-dot tp-dot--${session.status}`} />
                        <span className="tp-row-label">{session.label}</span>
                        {globalIndex < 9 && (
                          <span className="tp-row-kbd">⌥{globalIndex + 1}</span>
                        )}
                      </span>
                      <span className="tp-row-meta">
                        <span className="tp-row-profile">
                          {PROFILE_LABEL[session.profile]}
                        </span>
                        <span className="tp-row-sep">·</span>
                        <span className="tp-row-path">{compactPath(session.cwd)}</span>
                      </span>
                    </button>
                    <span className="tp-row-time">
                      {formatRelativeTime(session.lastActiveAt)}
                    </span>
                    <button
                      type="button"
                      className="tp-row-close"
                      aria-label={`Close ${session.label}`}
                      title={canStop ? "Stop & remove" : "Remove"}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDeleteSession(session.id);
                      }}
                      disabled={busyAction !== null}
                    >
                      <Icon.X size={11} sw={2} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ─── viewport / trace ─────────────────────────────────── */}
        <aside className="tp-trace">
          {!serviceOnline ? (
            <TPEmpty
              title="Terminal service is down"
              body="Start the PTY sidecar and this surface will come back."
              code="npm run terminal-service"
              error={error}
            />
          ) : !activeSession ? (
            <TPEmpty
              title="No thread selected"
              body="Open a shell from the header, or pick Claude / OpenCode. Each shell becomes a pinned thread."
              action={
                <button
                  type="button"
                  className="tp-pill"
                  onClick={() => void handleLaunch("shell")}
                  disabled={busyAction !== null}
                >
                  Open a shell <span className="tp-pill-kbd">{KBD_NEW_SHELL}</span>
                </button>
              }
            />
          ) : (
            <>
              <div className="tp-trace-head">
                <div className="tp-eyebrow">Active thread</div>
                <h3 className="tp-trace-title">{activeLabel}</h3>
                <div className="tp-trace-meta">
                  <span>{PROFILE_LABEL[activeSession.profile]}</span>
                  <span className="tp-trace-sep">·</span>
                  <SocketChip state={socketState} />
                  {detailPid && (
                    <>
                      <span className="tp-trace-sep">·</span>
                      <span>pid {detailPid}</span>
                    </>
                  )}
                  {detailCwd && (
                    <>
                      <span className="tp-trace-sep">·</span>
                      <code className="tp-trace-path" title={detailCwd}>
                        {compactPath(detailCwd)}
                      </code>
                    </>
                  )}
                </div>
                <div className="tp-trace-actions">
                  <button
                    type="button"
                    className="tp-pill-sm"
                    onClick={() => void handleCopyDirectory()}
                    disabled={!detailCwd}
                  >
                    Copy path
                  </button>
                  {activeCanStop && (
                    <button
                      type="button"
                      className="tp-pill-sm"
                      onClick={() => void handleKill()}
                      disabled={busyAction !== null}
                    >
                      Stop
                    </button>
                  )}
                  <button
                    type="button"
                    className="tp-pill-sm"
                    onClick={() => void handleRestart()}
                    disabled={busyAction !== null}
                    title={`Restart (${KBD_RESTART})`}
                  >
                    Restart
                  </button>
                  <button
                    type="button"
                    className="tp-pill-sm tp-pill-sm--danger"
                    onClick={() => void handleDelete()}
                    disabled={busyAction !== null}
                    title={`Close thread (${KBD_CLOSE})`}
                  >
                    Close
                  </button>
                </div>
              </div>
              <div
                className="tp-surface"
                data-hotkeys-ignore="true"
                onMouseDownCapture={() => focusTerminalSoon(0)}
                onClick={() => focusTerminalSoon(0)}
              >
                <Terminal
                  key={activeSessionKey}
                  ref={ref}
                  className="tp-screen"
                  cols={120}
                  rows={36}
                  autoResize
                  cursorBlink
                  data-hotkeys-ignore="true"
                  onReady={handleTerminalReady}
                  onResize={sendResize}
                  onData={sendInput}
                />
              </div>
              {errorNotice && <div className="tp-error">{errorNotice}</div>}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
function SocketChip({ state }: { state: SocketState }) {
  return <span className={`tp-socket tp-socket--${state}`}>{state}</span>;
}

function TPEmpty({
  title,
  body,
  code,
  action,
  error,
}: {
  title: string;
  body: string;
  code?: string;
  action?: React.ReactNode;
  error?: string | null;
}) {
  return (
    <div className="tp-empty">
      <div className="tp-empty-mark">
        <Icon.Terminal size={22} />
      </div>
      <h2 className="tp-empty-title">{title}</h2>
      <p className="tp-empty-body">{body}</p>
      {code && <code className="tp-empty-code">{code}</code>}
      {action}
      {error && <div className="tp-error">{error}</div>}
    </div>
  );
}

function compactPath(input: string): string {
  if (!input) return "—";
  const home =
    typeof window !== "undefined"
      ? (window as unknown as { __HOME__?: string }).__HOME__
      : undefined;
  let out = input;
  if (home && out.startsWith(home)) out = "~" + out.slice(home.length);
  const normalized = out.replace(/\/+$/, "");
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length <= 3) return out || "/";
  return `…/${segments.slice(-3).join("/")}`;
}

function formatRelativeTime(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  const deltaSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (deltaSeconds < 60) return "just now";
  if (deltaSeconds < 3600) return `${Math.floor(deltaSeconds / 60)}m`;
  if (deltaSeconds < 86400) return `${Math.floor(deltaSeconds / 3600)}h`;
  return `${Math.floor(deltaSeconds / 86400)}d`;
}
