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

const LAUNCH_ORDER: TerminalProfile[] = ["shell", "claude", "opencode"];

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
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowWrapRef = useRef<HTMLDivElement | null>(null);

  const focusTerminalSoon = useCallback(
    (delay = 0) => {
      if (typeof window === "undefined") return;
      window.setTimeout(() => {
        focus();
      }, delay);
    },
    [focus],
  );

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );
  const activeSessionKey = activeSession
    ? `${activeSession.id}:${activeSession.startedAt}`
    : null;

  useEffect(() => {
    if (activeSessionId && sessions.some((session) => session.id === activeSessionId)) {
      return;
    }
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
    if (!activeSessionKey || socketState !== "connected") {
      return;
    }
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

    socket.addEventListener("open", () => {
      setSocketState("connected");
    });

    socket.addEventListener("message", (event) => {
      let message: TerminalServerMessage;
      try {
        message = JSON.parse(String(event.data)) as TerminalServerMessage;
      } catch {
        return;
      }

      if (message.type === "output") {
        if (terminalReadyRef.current) {
          write(message.data);
        } else {
          pendingOutputRef.current.push(message.data);
        }
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
        setMeta((current) => ({ ...current, status: message.status }));
        return;
      }

      if (message.type === "exit") {
        setMeta((current) => ({ ...current, exitCode: message.exitCode }));
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

    return () => {
      socket.close();
    };
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
        setActionError(err instanceof Error ? err.message : "Unable to launch terminal session.");
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
      setActionError(err instanceof Error ? err.message : "Unable to restart session.");
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
      if (activeSessionId === deletedId) {
        setActiveSessionId(null);
      }
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
        if (activeSessionId === sessionId) {
          setActiveSessionId(null);
        }
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Unable to remove session.");
      } finally {
        setBusyAction(null);
      }
    },
    [activeSessionId, deleteSession],
  );

  const handleClearExited = useCallback(async () => {
    const staleSessions = sessions.filter(
      (session) => session.status === "exited" || session.status === "error",
    );
    if (staleSessions.length === 0) return;

    try {
      setActionError(null);
      setBusyAction("clear-exited");
      await Promise.all(staleSessions.map((session) => deleteSession(session.id)));
      if (staleSessions.some((session) => session.id === activeSessionId)) {
        setActiveSessionId(null);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Unable to clear old sessions.");
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
    for (const chunk of pendingOutputRef.current) {
      write(chunk);
    }
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

  // ── Close overflow on outside click ────────────────────────────────────
  useEffect(() => {
    if (!overflowOpen) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (overflowWrapRef.current && !overflowWrapRef.current.contains(target)) {
        setOverflowOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [overflowOpen]);

  // ── Derived ────────────────────────────────────────────────────────────
  const staleCount = sessions.filter(
    (session) => session.status === "exited" || session.status === "error",
  ).length;
  const runningCount = health?.running ?? sessions.filter((s) => s.status === "running").length;
  const detailStatus = meta.status ?? activeSession?.status ?? null;
  const detailCwd = meta.cwd ?? activeSession?.cwd ?? null;
  const detailPid = meta.pid ?? activeSession?.pid ?? null;
  const activeCanStop = detailStatus === "running" || detailStatus === "starting";
  const errorNotice = transportError || actionError || meta.error || null;
  const activeLabel = meta.label ?? activeSession?.label ?? null;

  return (
    <div className="tstage">
      {/* ── header ───────────────────────────────────────────────────── */}
      <header className="thead">
        <div className="thead-text">
          <div className="thead-eyebrow">Console</div>
          <h1 className="thead-title">Terminal</h1>
          <p className="thead-lede">
            Persistent PTYs for Claude, OpenCode, and shell work — switch threads on the left,
            drive the active session on the right.
          </p>
        </div>
        <div className="thead-actions">
          <div className={`thead-service ${serviceOnline ? "on" : "off"}`}>
            <span className="thead-service-dot" />
            <span className="thead-service-text">{serviceOnline ? "online" : "offline"}</span>
          </div>
          <div className="thead-stat">
            <span className="thead-stat-num">{sessions.length}</span>
            <span className="thead-stat-lbl">threads</span>
          </div>
          <div className="thead-stat">
            <span className="thead-stat-num">{runningCount}</span>
            <span className="thead-stat-lbl">live</span>
          </div>
          {loading && <span className="thead-sync">syncing…</span>}
        </div>
      </header>

      {/* ── split: thread rail + viewport ───────────────────────────── */}
      <div className="tsplit">
        {/* ── thread rail ─────────────────────────────────────────── */}
        <aside className="thread">
          <div className="thread-head">
            <span className="thread-head-label">Shells</span>
            <span className="thread-head-count">
              {sessions.length} {sessions.length === 1 ? "thread" : "threads"}
            </span>
          </div>

          {sessions.length === 0 ? (
            <div className="thread-empty">
              <div className="thread-empty-mark">
                <Icon.Terminal size={16} />
              </div>
              <div className="thread-empty-text">No shells yet.</div>
              <div className="thread-empty-sub">
                Launch one below — each becomes a pinned thread on this rail.
              </div>
            </div>
          ) : (
            <div className="thread-list">
              {sessions.map((session, i) => {
                const isActive = session.id === activeSessionId;
                const canStop = session.status === "running" || session.status === "starting";
                return (
                  <div
                    key={session.id}
                    className={`thread-item${isActive ? " on" : ""}`}
                  >
                    <button
                      type="button"
                      className="thread-item-main"
                      onClick={() => handleSelectSession(session.id)}
                      title={`${PROFILE_LABEL[session.profile]} — ${session.cwd}`}
                    >
                      <div className="thread-item-head">
                        <span className={`thread-item-dot thread-item-dot--${session.status}`} />
                        <span className="thread-item-label">{session.label}</span>
                        {i < 9 && <span className="thread-item-kbd">⌥{i + 1}</span>}
                      </div>
                      <div className="thread-item-meta">
                        <span className="thread-item-profile">{PROFILE_LABEL[session.profile]}</span>
                        <span className="thread-item-sep">·</span>
                        <span className="thread-item-time">{formatRelativeTime(session.lastActiveAt)}</span>
                        {session.status !== "running" && session.status !== "starting" && (
                          <>
                            <span className="thread-item-sep">·</span>
                            <span className={`thread-item-status thread-item-status--${session.status}`}>
                              {session.status}
                            </span>
                          </>
                        )}
                      </div>
                      <div className="thread-item-path">{compactPath(session.cwd)}</div>
                    </button>
                    <button
                      type="button"
                      className="thread-item-close"
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

          <div className="thread-footer">
            <div className="thread-footer-label">New shell</div>
            <div className="thread-launch-row">
              {LAUNCH_ORDER.map((profile) => (
                <button
                  key={profile}
                  type="button"
                  className={`thread-launch-chip${profile === "shell" ? " thread-launch-chip--primary" : ""}`}
                  onClick={() => void handleLaunch(profile)}
                  disabled={!serviceOnline || busyAction !== null}
                  title={`Launch ${PROFILE_LABEL[profile]}${profile === "shell" ? ` (${KBD_NEW_SHELL})` : ""}`}
                >
                  <span className="thread-launch-chip-label">{PROFILE_LABEL[profile]}</span>
                  {profile === "shell" && (
                    <span className="thread-launch-chip-kbd">{KBD_NEW_SHELL}</span>
                  )}
                </button>
              ))}
            </div>
            {staleCount > 0 && (
              <button
                type="button"
                className="thread-footer-link"
                onClick={() => void handleClearExited()}
                disabled={busyAction !== null}
              >
                Clear {staleCount} exited
              </button>
            )}
          </div>
        </aside>

        {/* ── viewport ─────────────────────────────────────────────── */}
        <section className="tview">
          {!serviceOnline ? (
            <div className="tview-empty">
              <div className="tview-empty-mark">
                <Icon.Terminal size={22} />
              </div>
              <h2>Terminal service is down</h2>
              <p>Start the PTY sidecar and this surface will come back.</p>
              <code className="tview-empty-cmd">npm run terminal-service</code>
              {error && <div className="tview-inline-error">{error}</div>}
            </div>
          ) : !activeSession ? (
            <div className="tview-empty">
              <div className="tview-empty-mark">
                <Icon.Terminal size={22} />
              </div>
              <h2>No thread selected</h2>
              <p>
                <button
                  type="button"
                  className="tview-empty-link"
                  onClick={() => void handleLaunch("shell")}
                  disabled={busyAction !== null}
                >
                  Open a shell
                </button>{" "}
                from the left rail, or pick Claude / OpenCode. Each shell becomes a thread.
              </p>
              <p className="tview-empty-hint">
                <kbd>{KBD_NEW_SHELL}</kbd> new shell · <kbd>⌥1</kbd>–<kbd>⌥9</kbd> switch ·{" "}
                <kbd>{KBD_CLOSE}</kbd> close · <kbd>{KBD_RESTART}</kbd> restart
              </p>
            </div>
          ) : (
            <>
              <div className="tview-bar">
                <div className="tview-bar-title-wrap">
                  <span className="tview-bar-profile">{PROFILE_LABEL[activeSession.profile]}</span>
                  <span className="tview-bar-title">{activeLabel}</span>
                </div>
                <div className="tview-bar-actions">
                  <button
                    type="button"
                    className="tview-bar-btn"
                    onClick={() => void handleCopyDirectory()}
                    disabled={!detailCwd}
                    title="Copy working directory"
                  >
                    copy cwd
                  </button>
                  <div className="tview-menu-wrap" ref={overflowWrapRef}>
                    <button
                      type="button"
                      className="tview-bar-btn tview-bar-btn--icon"
                      onClick={() => setOverflowOpen((v) => !v)}
                      aria-label="Session actions"
                      title="Session actions"
                    >
                      <span aria-hidden="true">⋮</span>
                    </button>
                    {overflowOpen && (
                      <div className="tview-menu" role="menu">
                        <button
                          type="button"
                          className="tview-menu-item"
                          onClick={() => {
                            setOverflowOpen(false);
                            void handleRestart();
                          }}
                          disabled={busyAction !== null}
                        >
                          <span className="tview-menu-item-label">Restart</span>
                          <span className="tview-menu-item-kbd">{KBD_RESTART}</span>
                        </button>
                        <button
                          type="button"
                          className="tview-menu-item"
                          onClick={() => {
                            setOverflowOpen(false);
                            void handleKill();
                          }}
                          disabled={!activeCanStop || busyAction !== null}
                        >
                          <span className="tview-menu-item-label">Stop</span>
                        </button>
                        <button
                          type="button"
                          className="tview-menu-item"
                          onClick={() => {
                            setOverflowOpen(false);
                            void handleDelete();
                          }}
                          disabled={busyAction !== null}
                        >
                          <span className="tview-menu-item-label">Close thread</span>
                          <span className="tview-menu-item-kbd">{KBD_CLOSE}</span>
                        </button>
                        <div className="tview-menu-sep" />
                        <button
                          type="button"
                          className="tview-menu-item"
                          onClick={() => {
                            setOverflowOpen(false);
                            void refresh();
                          }}
                        >
                          <span className="tview-menu-item-label">Refresh threads</span>
                        </button>
                        <button
                          type="button"
                          className="tview-menu-item"
                          onClick={() => {
                            setOverflowOpen(false);
                            void handleClearExited();
                          }}
                          disabled={staleCount === 0 || busyAction !== null}
                        >
                          <span className="tview-menu-item-label">
                            Clear exited{staleCount > 0 ? ` (${staleCount})` : ""}
                          </span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div
                className="tview-surface"
                data-hotkeys-ignore="true"
                onMouseDownCapture={() => focusTerminalSoon(0)}
                onClick={() => focusTerminalSoon(0)}
              >
                <Terminal
                  key={activeSessionKey}
                  ref={ref}
                  className="tview-screen"
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

              <div className="tview-status">
                <span className={`tview-chip tview-chip--${socketState}`}>{socketState}</span>
                {detailCwd && (
                  <span className="tview-status-mono" title={detailCwd}>
                    {compactPath(detailCwd)}
                  </span>
                )}
                {detailPid && <span className="tview-status-dim">pid {detailPid}</span>}
                <span className="tview-status-grow" />
                {errorNotice ? (
                  <span className="tview-status-err">{errorNotice}</span>
                ) : (
                  (health?.host || health?.port) && (
                    <span className="tview-status-dim">
                      {health?.host ?? "127.0.0.1"}:{health?.port ?? 4010}
                    </span>
                  )
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function compactPath(input: string): string {
  if (!input) return "—";
  const home = typeof window !== "undefined" ? (window as unknown as { __HOME__?: string }).__HOME__ : undefined;
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
  if (deltaSeconds < 3600) return `${Math.floor(deltaSeconds / 60)}m ago`;
  if (deltaSeconds < 86400) return `${Math.floor(deltaSeconds / 3600)}h ago`;
  return `${Math.floor(deltaSeconds / 86400)}d ago`;
}
