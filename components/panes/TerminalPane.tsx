"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
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

/**
 * Imperative handle exposed to parents via forwardRef. Kept small on
 * purpose — the workspace adapter (and the agent surface through it)
 * consumes exactly these two methods plus the onOutput callback, and
 * we don't want TerminalPane leaking its internal state model.
 */
export interface TerminalPaneHandle {
  /** Send keystrokes directly to the active session's stdin. */
  sendKeys: (keys: string) => { delivered: boolean; reason?: string };
  /** Return the last `chars` bytes of stdout/stderr (capped at the ring buffer). */
  readLastOutput: (chars?: number) => string;
}

export interface TerminalPaneProps {
  /** Fires once per output chunk arriving from the terminal service WS. */
  onOutput?: (data: string) => void;
}

/** Ring buffer max in chars — enough for a reasonable recent window. */
const OUTPUT_BUFFER_MAX = 64_000;

export const TerminalPane = forwardRef<TerminalPaneHandle, TerminalPaneProps>(
  function TerminalPane(props, handleRef) {
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
  const outputBufferRef = useRef<string>("");

  // onOutput needs the latest prop value without re-subscribing the
  // message listener on every render.
  const onOutputRef = useRef(props.onOutput);
  useEffect(() => { onOutputRef.current = props.onOutput; }, [props.onOutput]);

  useImperativeHandle(handleRef, () => ({
    sendKeys: (keys: string) => {
      const sock = socketRef.current;
      if (!sock || sock.readyState !== WebSocket.OPEN) {
        return { delivered: false, reason: "no active terminal session" };
      }
      sock.send(JSON.stringify({ type: "input", data: keys }));
      return { delivered: true };
    },
    readLastOutput: (chars = 4000) => {
      return outputBufferRef.current.slice(-Math.min(chars, OUTPUT_BUFFER_MAX));
    },
  }), []);

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
  const profileCounts = useMemo(
    () =>
      sessions.reduce(
        (counts, session) => {
          counts[session.profile] += 1;
          return counts;
        },
        { claude: 0, opencode: 0, shell: 0 } satisfies Record<TerminalProfile, number>,
      ),
    [sessions],
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

    let socket: WebSocket | null = null;
    let cancelled = false;
    setSocketState("connecting");
    setTransportError(null);

    (async () => {
      let wsUrl: string;
      try {
        wsUrl = await getTerminalWebSocketUrl(activeSessionId);
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
          outputBufferRef.current = next.length > OUTPUT_BUFFER_MAX
            ? next.slice(-OUTPUT_BUFFER_MAX)
            : next;
          onOutputRef.current?.(message.data);

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
    })();

    return () => {
      cancelled = true;
      socket?.close();
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
  const activeSummary = activeLabel ?? activeSession?.label ?? "No active session";
  const activeLocation = detailCwd
    ? compactPath(detailCwd)
    : activeSession?.cwd
      ? compactPath(activeSession.cwd)
      : "Launch Shell, Claude, or OpenCode";
  const serviceStateLabel = loading
    ? "Syncing"
    : serviceOnline
      ? "Service online"
      : "Service offline";
  const transportLabel = toTitleCase(socketState);
  const liveModeCount = profileCounts.claude + profileCounts.opencode;

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <section className="terminal-stage terminal-stage--deck">
      <header className="terminal-head terminal-head--deck">
        <div className="terminal-head-copy">
          <div className="label">Command Surface</div>
          <h1>Terminal</h1>
          <p>
            Persistent shells, Claude, and OpenCode sessions in one operational
            surface with pinned history, live transport state, and keyboard-first
            controls.
          </p>
        </div>
        <div className="warp-pane-actions">
          <span
            className={`pill--status ${
              serviceOnline ? "pill--status-finished" : "pill--status-error"
            }`}
          >
            {serviceStateLabel}
          </span>
          <button
            type="button"
            className="btn btn-secondary text-xs"
            onClick={() => void refresh()}
            disabled={loading || busyAction !== null}
          >
            {loading ? "Syncing…" : "Refresh"}
          </button>
          <button
            type="button"
            className="btn btn-primary text-xs"
            onClick={() => void handleLaunch("shell")}
            disabled={!serviceOnline || busyAction !== null}
            title={`New shell (${KBD_NEW_SHELL})`}
          >
            New shell
          </button>
        </div>
      </header>

      <div className="terminal-overview-grid terminal-overview-grid--deck">
        <OverviewCard
          label="Terminal Service"
          value={serviceOnline ? "Online" : "Offline"}
          sub={`${health?.host ?? "127.0.0.1"}:${health?.port ?? 4010}`}
          badge={loading ? "Syncing" : serviceOnline ? "Ready" : "Down"}
          tone={serviceOnline ? "ok" : "err"}
        />
        <OverviewCard
          label="Pinned Sessions"
          value={`${sessions.length}`}
          sub={`${runningCount} live${staleCount > 0 ? ` · ${staleCount} exited` : ""}`}
          badge={sessions.length > 0 ? `${profileCounts.shell} shell` : "None"}
        />
        <OverviewCard
          label="Active Focus"
          value={activeSummary}
          sub={activeLocation}
          badge={activeSession ? PROFILE_LABEL[activeSession.profile] : "Idle"}
          accent={Boolean(activeSession)}
        />
        <OverviewCard
          label="Transport"
          value={transportLabel}
          sub={
            activeSession
              ? `PID ${detailPid ?? "—"} · ${liveModeCount} agent session${
                  liveModeCount === 1 ? "" : "s"
                }`
              : `${KBD_NEW_SHELL} new shell · ${KBD_CLOSE} close`
          }
          badge={activeSession ? socketState : "Idle"}
          tone={socketState === "error" ? "err" : socketState === "connected" ? "ok" : "neutral"}
        />
      </div>

      <div className="terminal-deck-shell warp-pane-card">
        <div className="tp-root">
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
              <div className="tp-crumb tp-crumb--empty">No active session</div>
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
                    title={`Close session (${KBD_CLOSE})`}
                  >
                    close
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="tp-main">
            <aside className="tp-sidebar">
              <div className="tp-sidebar-launch">
                <div className="tp-sidebar-head">
                  <div>
                    <div className="tp-sidebar-kicker">Launch</div>
                    <div className="tp-sidebar-copy">
                      Start a session or jump back into a pinned one.
                    </div>
                  </div>
                  <span className="tp-sidebar-count">
                    {sessions.length} session{sessions.length === 1 ? "" : "s"}
                  </span>
                </div>
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
              <div className="tp-sidebar-list">
                {sessions.length === 0 ? (
                  <div className="tp-sidebar-empty">No sessions yet. Launch one above to begin.</div>
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
              <SessionContextBox
                session={activeSession}
                status={detailStatus}
                pid={detailPid}
                exitCode={meta.exitCode ?? null}
                errorText={meta.error ?? null}
                serviceOnline={serviceOnline}
                staleCount={staleCount}
                busy={busyAction !== null}
                onRestart={() => void handleRestart()}
                onKill={() => void handleKill()}
              />
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
                  title="No session selected"
                  body="Open a shell from the left, or pick Claude / OpenCode. Each launch becomes a pinned session."
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

          <div className="tp-statusbar">
            <span className={`tp-socket tp-socket--${socketState}`}>{socketState}</span>
            {detailPid && <span className="tp-statusbar-item">pid {detailPid}</span>}
            <span className="tp-statusbar-item tp-statusbar-dim">
              {sessions.length} session{sessions.length === 1 ? "" : "s"} · {runningCount} live
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
      </div>
    </section>
  );
});

// ──────────────────────────────────────────────────────────────────────
function OverviewCard({
  label,
  value,
  sub,
  badge,
  tone = "neutral",
  accent = false,
}: {
  label: string;
  value: string;
  sub: string;
  badge?: string;
  tone?: "neutral" | "ok" | "err";
  accent?: boolean;
}) {
  return (
    <article
      className={`terminal-overview-card${accent ? " terminal-overview-card--accent" : ""}`}
    >
      <div className="terminal-overview-card-top">
        <span className="terminal-overview-label">{label}</span>
        {badge ? (
          <span className={`terminal-overview-badge terminal-overview-badge--${tone}`}>
            {badge}
          </span>
        ) : null}
      </div>
      <div className="terminal-overview-value" title={value}>
        {value}
      </div>
      <div className="terminal-overview-sub" title={sub}>
        {sub}
      </div>
    </article>
  );
}

// ──────────────────────────────────────────────────────────────────────
function SessionContextBox({
  session,
  status,
  pid,
  exitCode,
  errorText,
  serviceOnline,
  staleCount,
  busy,
  onRestart,
  onKill,
}: {
  session: TerminalSession | null;
  status: TerminalSessionStatus | null;
  pid: number | null;
  exitCode: number | null;
  errorText: string | null;
  serviceOnline: boolean;
  staleCount: number;
  busy: boolean;
  onRestart: () => void;
  onKill: () => void;
}) {
  // offline
  if (!serviceOnline) {
    return (
      <div className="tp-nowbox tp-nowbox--offline">
        <div className="tp-nowbox-head">
          <span className="tp-nowbox-tag tp-nowbox-tag--warn">OFFLINE</span>
        </div>
        <div className="tp-nowbox-body">
          <div className="tp-nowbox-line tp-nowbox-dim">PTY sidecar isn't responding.</div>
          <code className="tp-nowbox-code">npm run terminal-service</code>
        </div>
      </div>
    );
  }

  // no active session
  if (!session) {
    return (
      <div className="tp-nowbox tp-nowbox--idle">
        <div className="tp-nowbox-head">
          <span className="tp-nowbox-tag">IDLE</span>
        </div>
        <div className="tp-nowbox-body">
          <div className="tp-nowbox-line tp-nowbox-dim">No session attached.</div>
          <div className="tp-nowbox-line tp-nowbox-dim">
            Launch one above, or pick a session from the list.
          </div>
        </div>
      </div>
    );
  }

  const isAgent = session.profile === "claude" || session.profile === "opencode";
  const isRunning = status === "running" || status === "starting";
  const isExited = status === "exited" || status === "error";

  // exited — show exit code + restart
  if (isExited) {
    const code = typeof exitCode === "number" ? exitCode : null;
    return (
      <div className="tp-nowbox tp-nowbox--exited">
        <div className="tp-nowbox-head">
          <span className="tp-nowbox-tag tp-nowbox-tag--err">EXITED</span>
          {code !== null && (
            <span
              className={`tp-nowbox-code-chip tp-nowbox-code-chip--${code === 0 ? "ok" : "err"}`}
            >
              code {code}
            </span>
          )}
        </div>
        <div className="tp-nowbox-body">
          <div className="tp-nowbox-line tp-nowbox-dim">
            stopped {formatRelativeTime(session.lastActiveAt)}
          </div>
          {errorText && <div className="tp-nowbox-line tp-nowbox-err">{errorText}</div>}
          <button type="button" className="tp-nowbox-cta" onClick={onRestart} disabled={busy}>
            Restart session
          </button>
        </div>
      </div>
    );
  }

  // agent running — task stack scaffold
  if (isAgent && isRunning) {
    return (
      <div className="tp-nowbox tp-nowbox--agent">
        <div className="tp-nowbox-head">
          <span className="tp-nowbox-tag">TASK STACK</span>
          <span className="tp-nowbox-pulse" />
        </div>
        <div className="tp-nowbox-body">
          <div className="tp-nowbox-line tp-nowbox-dim">
            {PROFILE_LABEL[session.profile]} running · pid {pid ?? "—"}
          </div>
          <div className="tp-nowbox-stack">
            <div className="tp-nowbox-stack-empty">
              Tasks will land here as the agent works.
            </div>
          </div>
          <button type="button" className="tp-nowbox-cta tp-nowbox-cta--ghost" onClick={onKill} disabled={busy}>
            <Icon.Stop size={10} sw={2} />
            <span>Stop agent</span>
          </button>
        </div>
      </div>
    );
  }

  // shell running — live NOW panel
  return (
    <div className="tp-nowbox tp-nowbox--now">
      <div className="tp-nowbox-head">
        <span className="tp-nowbox-tag">NOW</span>
        <span className="tp-nowbox-pulse" />
      </div>
      <div className="tp-nowbox-body">
        <div className="tp-nowbox-row">
          <span className="tp-nowbox-key">uptime</span>
          <span className="tp-nowbox-val">{formatRelativeTime(session.startedAt)}</span>
        </div>
        {pid && (
          <div className="tp-nowbox-row">
            <span className="tp-nowbox-key">pid</span>
            <span className="tp-nowbox-val">{pid}</span>
          </div>
        )}
        <div className="tp-nowbox-row">
          <span className="tp-nowbox-key">close</span>
          <span className="tp-nowbox-val">
            <kbd className="tp-nowbox-kbd">{KBD_CLOSE}</kbd> or <code>exit</code>
          </span>
        </div>
        {staleCount > 0 && (
          <div className="tp-nowbox-line tp-nowbox-dim tp-nowbox-stale">
            {staleCount} exited · clean up
          </div>
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

function toTitleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
