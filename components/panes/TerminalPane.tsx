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

  const focusTerminalSoon = useCallback(
    (delay = 0) => {
      if (typeof window === "undefined") return;
      window.setTimeout(() => focus(), delay);
    },
    [focus],
  );

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
    <div className="tp-root">
      {/* ─── top strip: active-thread breadcrumb + actions ─────────── */}
      <div className="tp-topbar">
        {activeSession ? (
          <div className="tp-crumb">
            <span className={`tp-crumb-dot tp-crumb-dot--${activeSession.status}`} />
            <span className="tp-crumb-profile">{PROFILE_LABEL[activeSession.profile]}</span>
            <span className="tp-crumb-slash">/</span>
            <span className="tp-crumb-label">{activeLabel}</span>
            {detailCwd && (
              <code className="tp-crumb-path" title={detailCwd}>
                {compactPath(detailCwd)}
              </code>
            )}
          </div>
        ) : (
          <div className="tp-crumb tp-crumb--empty">No active thread</div>
        )}
        <div className="tp-topbar-actions">
          {activeSession && (
            <>
              <button
                type="button"
                className="tp-chip"
                onClick={() => void handleCopyDirectory()}
                disabled={!detailCwd}
                title="Copy working directory"
              >
                copy path
              </button>
              {activeCanStop && (
                <button
                  type="button"
                  className="tp-chip"
                  onClick={() => void handleKill()}
                  disabled={busyAction !== null}
                >
                  stop
                </button>
              )}
              <button
                type="button"
                className="tp-chip"
                onClick={() => void handleRestart()}
                disabled={busyAction !== null}
                title={`Restart (${KBD_RESTART})`}
              >
                restart
              </button>
              <button
                type="button"
                className="tp-chip tp-chip--danger"
                onClick={() => void handleDelete()}
                disabled={busyAction !== null}
                title={`Close thread (${KBD_CLOSE})`}
              >
                close
              </button>
            </>
          )}
        </div>
      </div>

      {/* ─── main: sidebar + surface ───────────────────────────────── */}
      <div className="tp-main">
        <aside className="tp-sidebar">
          <div className="tp-sidebar-list">
            {sessions.length === 0 ? (
              <div className="tp-sidebar-empty">No shells yet.</div>
            ) : (
              sessions.map((session, i) => {
                const isActive = session.id === activeSessionId;
                return (
                  <div
                    key={session.id}
                    className={`tp-thread${isActive ? " tp-thread--on" : ""}`}
                  >
                    <button
                      type="button"
                      className="tp-thread-main"
                      onClick={() => handleSelectSession(session.id)}
                      title={`${PROFILE_LABEL[session.profile]} — ${session.cwd}`}
                    >
                      <span className={`tp-thread-dot tp-thread-dot--${session.status}`} />
                      <div className="tp-thread-body">
                        <div className="tp-thread-row">
                          <span className="tp-thread-name">{session.label}</span>
                          {i < 9 && <span className="tp-thread-kbd">⌥{i + 1}</span>}
                        </div>
                        <div className="tp-thread-meta">
                          <span>{PROFILE_LABEL[session.profile]}</span>
                          <span className="tp-thread-sep">·</span>
                          <span>{formatRelativeTime(session.lastActiveAt)}</span>
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      className="tp-thread-close"
                      aria-label={`Close ${session.label}`}
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
              })
            )}
          </div>
          <div className="tp-sidebar-new">
            <button
              type="button"
              className="tp-new-btn tp-new-btn--primary"
              onClick={() => void handleLaunch("shell")}
              disabled={!serviceOnline || busyAction !== null}
              title={`New shell (${KBD_NEW_SHELL})`}
            >
              <Icon.Plus size={12} sw={2} />
              <span>Shell</span>
              <span className="tp-new-btn-kbd">{KBD_NEW_SHELL}</span>
            </button>
            <button
              type="button"
              className="tp-new-btn"
              onClick={() => void handleLaunch("claude")}
              disabled={!serviceOnline || busyAction !== null}
            >
              <Icon.Plus size={12} sw={2} />
              <span>Claude</span>
            </button>
            <button
              type="button"
              className="tp-new-btn"
              onClick={() => void handleLaunch("opencode")}
              disabled={!serviceOnline || busyAction !== null}
            >
              <Icon.Plus size={12} sw={2} />
              <span>OpenCode</span>
            </button>
          </div>
        </aside>

        <div className="tp-surface-wrap">
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
              body="Open a shell from the left, or pick Claude / OpenCode. Each shell becomes a pinned thread."
              action={
                <button
                  type="button"
                  className="tp-new-btn tp-new-btn--primary"
                  onClick={() => void handleLaunch("shell")}
                  disabled={busyAction !== null}
                >
                  <Icon.Plus size={12} sw={2} />
                  <span>Shell</span>
                  <span className="tp-new-btn-kbd">{KBD_NEW_SHELL}</span>
                </button>
              }
            />
          ) : (
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
          )}
        </div>
      </div>

      {/* ─── bottom status bar ──────────────────────────────────────── */}
      <div className="tp-statusbar">
        <span className={`tp-socket tp-socket--${socketState}`}>{socketState}</span>
        {detailPid && <span className="tp-statusbar-item">pid {detailPid}</span>}
        <span className="tp-statusbar-item tp-statusbar-dim">
          {sessions.length} thread{sessions.length === 1 ? "" : "s"} · {runningCount} live
          {staleCount > 0 && ` · ${staleCount} exited`}
        </span>
        <span className="tp-statusbar-grow" />
        {errorNotice ? (
          <span className="tp-statusbar-err" title={errorNotice}>
            {errorNotice}
          </span>
        ) : (
          <span className="tp-statusbar-item tp-statusbar-dim">
            {serviceOnline ? "● online" : "○ offline"} · {health?.host ?? "127.0.0.1"}:
            {health?.port ?? 4010}
          </span>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
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
      {error && <div className="tp-empty-error">{error}</div>}
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
