"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Terminal, useTerminal } from "@wterm/react";
import { Icon } from "@/components/warp/Icons";
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
const PROFILE_ORDER: TerminalProfile[] = ["claude", "opencode", "shell"];

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

const PROFILE_COPY: Record<TerminalSession["profile"], { title: string; hint: string }> = {
  claude: {
    title: "Claude CLI",
    hint: "Persistent agent shell for local Claude workflows.",
  },
  opencode: {
    title: "OpenCode CLI",
    hint: "Keep OpenCode attached to the same Control Deck session rail.",
  },
  shell: {
    title: "Shell",
    hint: "General-purpose PTY for repo tasks, logs, and one-off commands.",
  },
};

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
        setMeta((current) => ({
          ...current,
          status: message.status,
        }));
        return;
      }

      if (message.type === "exit") {
        setMeta((current) => ({
          ...current,
          exitCode: message.exitCode,
        }));
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

  const handleLaunch = async (profile: TerminalProfile) => {
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
  };

  const handleRestart = async () => {
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
  };

  const handleKill = async () => {
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
  };

  const handleDelete = async () => {
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
  };

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

  const handleKillSession = useCallback(
    async (sessionId: string) => {
      try {
        setActionError(null);
        setBusyAction(`kill:${sessionId}`);
        await killSession(sessionId);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Unable to stop session.");
      } finally {
        setBusyAction(null);
      }
    },
    [killSession],
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

  const sessionCount = health?.sessions ?? sessions.length;
  const runningCount = health?.running ?? sessions.filter((session) => session.status === "running").length;
  const staleCount = sessions.filter(
    (session) => session.status === "exited" || session.status === "error",
  ).length;
  const detailSession = activeSession ?? null;
  const detailProfile = detailSession ? PROFILE_COPY[detailSession.profile] : null;
  const detailStatus = meta.status ?? detailSession?.status ?? null;
  const detailCwd = meta.cwd ?? detailSession?.cwd ?? null;
  const detailPid = meta.pid ?? detailSession?.pid ?? null;
  const detailLastActive = detailSession?.lastActiveAt ?? null;
  const activeCanStop = detailStatus === "running" || detailStatus === "starting";

  return (
    <div className="terminal-stage">
      <header className="terminal-head terminal-head--compact">
        <div>
          <div className="label">Console</div>
          <h1>Terminal</h1>
          <p>Persistent PTYs for Claude, OpenCode, and shell work inside the deck.</p>
        </div>
        <div className="warp-pane-actions terminal-overview">
          {loading && <span className="pill--mono">syncing</span>}
          <span className="pill--mono">{sessionCount} tracked</span>
          <span className="pill--mono">{runningCount} running</span>
          <button className="btn btn-secondary text-xs" onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
      </header>

      <div className="terminal-layout">
        <aside className="terminal-launcher">
          <section className="terminal-rail-card">
            <div className="terminal-launcher-head">
              <span>Profiles</span>
              <span className={`terminal-service-state ${serviceOnline ? "online" : "offline"}`}>
                {serviceOnline ? "online" : "offline"}
              </span>
            </div>
            <div className="terminal-profile-grid">
              {PROFILE_ORDER.map((profile) => (
                <button
                  key={profile}
                  className="terminal-profile-chip"
                  onClick={() => void handleLaunch(profile)}
                  disabled={busyAction !== null || !serviceOnline}
                >
                  <div className="terminal-profile-title">
                    {profile === "shell"
                      ? "New Shell"
                      : `Launch ${PROFILE_COPY[profile].title.replace(" CLI", "")}`}
                  </div>
                  <div className="terminal-profile-copy">{PROFILE_COPY[profile].hint}</div>
                </button>
              ))}
            </div>
          </section>

          <section className="terminal-rail-card">
            <div className="terminal-launcher-head">
              <span>Utilities</span>
              <span>{health?.host ?? "127.0.0.1"}:{health?.port ?? 4010}</span>
            </div>
            <div className="terminal-utility-grid">
              <button className="terminal-utility-btn" onClick={() => void refresh()}>
                Refresh
              </button>
              <button
                className="terminal-utility-btn"
                onClick={() => focusTerminalSoon(0)}
                disabled={!detailSession}
              >
                Focus
              </button>
              <button
                className="terminal-utility-btn"
                onClick={() => void handleCopyDirectory()}
                disabled={!detailCwd}
              >
                Copy Path
              </button>
              <button
                className="terminal-utility-btn"
                onClick={() => void handleClearExited()}
                disabled={staleCount === 0 || busyAction !== null}
              >
                Clear Old
              </button>
            </div>
          </section>

          <section className="terminal-rail-card terminal-session-card">
            <div className="terminal-list-head">
              <span>Sessions</span>
              <span>{sessions.length}</span>
            </div>
            {sessions.length === 0 ? (
              <div className="terminal-empty-card">
                <div>No sessions yet.</div>
                <div>Start one of the launch profiles to pin a PTY to this rail.</div>
              </div>
            ) : (
              <div className="terminal-session-list">
                {sessions.map((session) => {
                  const isActive = session.id === activeSessionId;
                  const canStop = session.status === "running" || session.status === "starting";
                  return (
                    <article
                      key={session.id}
                      className={`terminal-session-item ${isActive ? "on" : ""}`}
                    >
                      <button
                        type="button"
                        className="terminal-session-main"
                        onClick={() => handleSelectSession(session.id)}
                      >
                        <div className="terminal-session-row">
                          <div className="terminal-session-title-wrap">
                            <div className="terminal-session-title">{session.label}</div>
                            <span className={`terminal-status-chip terminal-status-chip--${session.status}`}>
                              {session.status}
                            </span>
                          </div>
                        </div>
                        <div className="terminal-session-meta">
                          <span>{PROFILE_COPY[session.profile].title}</span>
                          <span>{formatRelativeTime(session.lastActiveAt)}</span>
                        </div>
                        <div className="terminal-session-path">{compactPath(session.cwd)}</div>
                      </button>
                      <div className="terminal-session-actions">
                        <button
                          type="button"
                          className="terminal-session-icon"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleDeleteSession(session.id);
                          }}
                          disabled={busyAction !== null}
                          aria-label={`Remove ${session.label}`}
                          title="Remove session"
                        >
                          <Icon.X size={12} sw={1.6} />
                        </button>
                        <button
                          type="button"
                          className="terminal-session-icon"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleKillSession(session.id);
                          }}
                          disabled={busyAction !== null || !canStop}
                          aria-label={`Stop ${session.label}`}
                          title="Stop session"
                        >
                          <Icon.Stop size={11} sw={1.6} />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </aside>

        <section className="terminal-main-shell">
          {!serviceOnline ? (
            <div className="terminal-offline">
              <div className="terminal-offline-mark">
                <Icon.Terminal size={18} />
              </div>
              <h2>Terminal service is down</h2>
              <p>
                Start the PTY sidecar, then refresh this surface. The deck expects it on
                <code> localhost:4010</code> by default.
              </p>
              <div className="terminal-code-block">npm run terminal-service</div>
              {error && <div className="terminal-inline-error">{error}</div>}
            </div>
          ) : !activeSession ? (
            <div className="terminal-offline">
              <div className="terminal-offline-mark">
                <Icon.Terminal size={18} />
              </div>
              <h2>Pick a session</h2>
              <p>Launch Claude, OpenCode, or a shell to bring a PTY into the main viewport.</p>
            </div>
          ) : (
            <>
              <div className="terminal-toolbar">
                <div className="terminal-toolbar-copy">
                  <div className="label">Active Session</div>
                  <div className="terminal-toolbar-title">{meta.label ?? activeSession.label}</div>
                </div>
                <div className="terminal-toolbar-actions">
                  <span className={`terminal-transport-chip terminal-transport-chip--${socketState}`}>
                    {socketState}
                  </span>
                  <button
                    className="btn btn-secondary text-xs"
                    onClick={() => void handleRestart()}
                    disabled={busyAction !== null}
                  >
                    Restart
                  </button>
                  <button
                    className="btn btn-secondary text-xs"
                    onClick={() => void handleKill()}
                    disabled={busyAction !== null || !activeCanStop}
                  >
                    Stop
                  </button>
                  <button
                    className="btn btn-secondary text-xs"
                    onClick={() => void handleDelete()}
                    disabled={busyAction !== null}
                  >
                    Remove
                  </button>
                </div>
              </div>

              <div className="terminal-meta-strip">
                <span className="terminal-meta-pill">{detailProfile?.title ?? activeSession.profile}</span>
                {detailCwd ? (
                  <span className="terminal-meta-pill terminal-meta-pill--mono">
                    {compactPath(detailCwd)}
                  </span>
                ) : null}
                {detailPid ? (
                  <span className="terminal-meta-pill terminal-meta-pill--mono">pid {detailPid}</span>
                ) : null}
                {detailLastActive ? (
                  <span className="terminal-meta-pill">{formatRelativeTime(detailLastActive)}</span>
                ) : null}
                <span className="terminal-meta-pill">{runningCount} live</span>
              </div>

              <div
                className="terminal-surface"
                data-hotkeys-ignore="true"
                onMouseDownCapture={() => focusTerminalSoon(0)}
                onClick={() => focusTerminalSoon(0)}
              >
                <Terminal
                  key={activeSessionKey}
                  ref={ref}
                  className="terminal-screen"
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

              {(transportError || actionError || meta.error) && (
                <div className="terminal-inline-error">
                  {actionError ?? transportError ?? meta.error}
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {loading && <div className="terminal-loading">Loading terminal service state...</div>}
    </div>
  );
}

function compactPath(input: string): string {
  if (!input) return "-";
  const normalized = input.replace(/\/+$/, "");
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length <= 3) return input;
  return `.../${segments.slice(-3).join("/")}`;
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
