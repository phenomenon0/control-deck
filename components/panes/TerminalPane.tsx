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

// Short accelerators rendered in the launcher/overflow menus. The actual
// shortcuts are registered via useShortcut below.
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
  const [launchMenuOpen, setLaunchMenuOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const launchWrapRef = useRef<HTMLDivElement | null>(null);
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
  // Fire only when focus is NOT inside the terminal input (no-input guard).
  // The terminal surface is marked data-hotkeys-ignore so typing inside the
  // PTY never triggers these; the shortcuts fire when you're anywhere else
  // in the deck.
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

  // ── Close open popovers on outside click ───────────────────────────────
  useEffect(() => {
    if (!launchMenuOpen && !overflowOpen) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (launchMenuOpen && launchWrapRef.current && !launchWrapRef.current.contains(target)) {
        setLaunchMenuOpen(false);
      }
      if (overflowOpen && overflowWrapRef.current && !overflowWrapRef.current.contains(target)) {
        setOverflowOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [launchMenuOpen, overflowOpen]);

  // ── Derived state ──────────────────────────────────────────────────────
  const staleCount = sessions.filter(
    (session) => session.status === "exited" || session.status === "error",
  ).length;
  const detailStatus = meta.status ?? activeSession?.status ?? null;
  const detailCwd = meta.cwd ?? activeSession?.cwd ?? null;
  const detailPid = meta.pid ?? activeSession?.pid ?? null;
  const activeCanStop = detailStatus === "running" || detailStatus === "starting";
  const errorNotice = transportError || actionError || meta.error || null;

  const launchMenuItems: Array<{ profile: TerminalProfile; icon: React.ReactNode; kbd?: string }> = [
    { profile: "shell", icon: <Icon.Terminal size={12} />, kbd: KBD_NEW_SHELL },
    { profile: "claude", icon: <Icon.Box size={12} /> },
    { profile: "opencode", icon: <Icon.Code size={12} /> },
  ];

  return (
    <div className="terminal-stage terminal-stage--v2">
      {/* ── slim header ──────────────────────────────────────────────── */}
      <header className="terminal-head terminal-head--slim">
        <div className="terminal-head-title">
          <span className="label">Console</span>
          <h1>Terminal</h1>
        </div>
        <div className="terminal-head-right">
          <span
            className={`terminal-service-dot ${serviceOnline ? "on" : "off"}`}
            title={serviceOnline ? "service online" : "service offline"}
            aria-label={serviceOnline ? "service online" : "service offline"}
          />
          <span className="terminal-head-count">{sessions.length} session{sessions.length === 1 ? "" : "s"}</span>
          {loading && <span className="terminal-head-sync">syncing…</span>}
        </div>
      </header>

      {/* ── tab strip + viewport ─────────────────────────────────────── */}
      <div className="terminal-shell">
        <div className="terminal-tabbar" role="tablist">
          <div className="terminal-tabs">
            {sessions.map((session, i) => {
              const isActive = session.id === activeSessionId;
              return (
                <button
                  key={session.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`terminal-tab${isActive ? " on" : ""} terminal-tab--${session.status}`}
                  onClick={() => handleSelectSession(session.id)}
                  title={`${PROFILE_LABEL[session.profile]} — ${session.cwd}`}
                >
                  <span className={`terminal-tab-dot terminal-tab-dot--${session.status}`} />
                  <span className="terminal-tab-label">{session.label}</span>
                  {i < 9 && <span className="terminal-tab-kbd">⌥{i + 1}</span>}
                  <span
                    role="button"
                    tabIndex={-1}
                    className="terminal-tab-close"
                    aria-label={`Close ${session.label}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleDeleteSession(session.id);
                    }}
                  >
                    <Icon.X size={10} sw={2} />
                  </span>
                </button>
              );
            })}
          </div>

          <div className="terminal-tabbar-right">
            <div className="terminal-menu-wrap" ref={launchWrapRef}>
              <button
                type="button"
                className="terminal-tab-new"
                onClick={() => setLaunchMenuOpen((v) => !v)}
                disabled={!serviceOnline || busyAction !== null}
                title={`New terminal (${KBD_NEW_SHELL})`}
              >
                <Icon.Plus size={12} sw={2} />
                <span>New</span>
              </button>
              {launchMenuOpen && (
                <div className="terminal-menu" role="menu">
                  {launchMenuItems.map(({ profile, icon, kbd }) => (
                    <button
                      key={profile}
                      type="button"
                      className="terminal-menu-item"
                      onClick={() => {
                        setLaunchMenuOpen(false);
                        void handleLaunch(profile);
                      }}
                      disabled={busyAction !== null}
                    >
                      <span className="terminal-menu-item-icon">{icon}</span>
                      <span className="terminal-menu-item-label">{PROFILE_LABEL[profile]}</span>
                      {kbd && <span className="terminal-menu-item-kbd">{kbd}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="terminal-menu-wrap" ref={overflowWrapRef}>
              <button
                type="button"
                className="terminal-tab-overflow"
                onClick={() => setOverflowOpen((v) => !v)}
                disabled={!activeSession && staleCount === 0}
                title="Session actions"
                aria-label="Session actions"
              >
                <span aria-hidden="true">⋮</span>
              </button>
              {overflowOpen && (
                <div className="terminal-menu terminal-menu--right" role="menu">
                  <button
                    type="button"
                    className="terminal-menu-item"
                    onClick={() => {
                      setOverflowOpen(false);
                      void handleRestart();
                    }}
                    disabled={!activeSession || busyAction !== null}
                  >
                    <span className="terminal-menu-item-label">Restart</span>
                    <span className="terminal-menu-item-kbd">{KBD_RESTART}</span>
                  </button>
                  <button
                    type="button"
                    className="terminal-menu-item"
                    onClick={() => {
                      setOverflowOpen(false);
                      void handleKill();
                    }}
                    disabled={!activeSession || !activeCanStop || busyAction !== null}
                  >
                    <span className="terminal-menu-item-label">Stop</span>
                  </button>
                  <button
                    type="button"
                    className="terminal-menu-item"
                    onClick={() => {
                      setOverflowOpen(false);
                      void handleDelete();
                    }}
                    disabled={!activeSession || busyAction !== null}
                  >
                    <span className="terminal-menu-item-label">Close</span>
                    <span className="terminal-menu-item-kbd">{KBD_CLOSE}</span>
                  </button>
                  <div className="terminal-menu-sep" />
                  <button
                    type="button"
                    className="terminal-menu-item"
                    onClick={() => {
                      setOverflowOpen(false);
                      void handleCopyDirectory();
                    }}
                    disabled={!detailCwd}
                  >
                    <span className="terminal-menu-item-label">Copy cwd</span>
                  </button>
                  <button
                    type="button"
                    className="terminal-menu-item"
                    onClick={() => {
                      setOverflowOpen(false);
                      void refresh();
                    }}
                  >
                    <span className="terminal-menu-item-label">Refresh</span>
                  </button>
                  <button
                    type="button"
                    className="terminal-menu-item"
                    onClick={() => {
                      setOverflowOpen(false);
                      void handleClearExited();
                    }}
                    disabled={staleCount === 0 || busyAction !== null}
                  >
                    <span className="terminal-menu-item-label">
                      Clear exited{staleCount > 0 ? ` (${staleCount})` : ""}
                    </span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── main viewport ────────────────────────────────────────── */}
        {!serviceOnline ? (
          <div className="terminal-empty">
            <div className="terminal-empty-mark">
              <Icon.Terminal size={22} />
            </div>
            <h2>Terminal service is down</h2>
            <p>Start the PTY sidecar and this surface will come back.</p>
            <code className="terminal-empty-cmd">npm run terminal-service</code>
            {error && <div className="terminal-inline-error">{error}</div>}
          </div>
        ) : !activeSession ? (
          <div className="terminal-empty">
            <div className="terminal-empty-mark">
              <Icon.Terminal size={22} />
            </div>
            <h2>No terminal yet</h2>
            <p>
              <button
                type="button"
                className="terminal-empty-link"
                onClick={() => void handleLaunch("shell")}
                disabled={busyAction !== null}
              >
                Open a shell
              </button>{" "}
              or pick Claude / OpenCode from the <span className="terminal-empty-kbd">+ New</span> menu.
            </p>
            <p className="terminal-empty-hint">
              <kbd>{KBD_NEW_SHELL}</kbd> new shell · <kbd>⌥1</kbd>–<kbd>⌥9</kbd> switch ·{" "}
              <kbd>{KBD_CLOSE}</kbd> close
            </p>
          </div>
        ) : (
          <>
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

            <div className="terminal-statusbar">
              <span className={`terminal-statusbar-chip terminal-transport--${socketState}`}>
                {socketState}
              </span>
              <span className="terminal-statusbar-dim">{PROFILE_LABEL[activeSession.profile]}</span>
              {detailCwd && (
                <span className="terminal-statusbar-mono" title={detailCwd}>
                  {compactPath(detailCwd)}
                </span>
              )}
              {detailPid && <span className="terminal-statusbar-dim">pid {detailPid}</span>}
              <span className="terminal-statusbar-grow" />
              {errorNotice && <span className="terminal-statusbar-err">{errorNotice}</span>}
              {!errorNotice && (health?.host || health?.port) && (
                <span className="terminal-statusbar-dim">
                  {health?.host ?? "127.0.0.1"}:{health?.port ?? 4010}
                </span>
              )}
            </div>
          </>
        )}
      </div>
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
