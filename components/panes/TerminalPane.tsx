"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Terminal, useTerminal } from "@wterm/react";
import { useShortcut } from "@/lib/hooks/useShortcuts";
import { useTerminalSessions } from "@/lib/hooks/useTerminalSessions";
import { getTerminalWebSocketUrl } from "@/lib/terminal/client";
import { useTerminalAgui } from "@/lib/terminal/useTerminalAgui";
import type {
  TerminalMetaMessage,
  TerminalProfile,
  TerminalServerMessage,
  TerminalSession,
  TerminalSessionStatus,
} from "@/lib/terminal/types";
import { StatusBar, TabStrip, Topbar, defaultModeFor, compactPath, type TerminalMode } from "./terminal/parts";
import { TerminalClassic } from "./terminal/TerminalClassic";
import { TerminalAgent, useAgentTimeline, type AgentAutonomy } from "./terminal/TerminalAgent";

const LAST_SESSION_KEY = "deck:last-terminal-session";
const MODE_OVERRIDE_KEY = "deck:terminal-mode";
const AUTONOMY_KEY = "deck:terminal-autonomy";
const RAIL_KEY = "deck:terminal-rail-collapsed";
const TIMELINE_WIDTH_KEY = "deck:terminal-timeline-width";

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

export interface TerminalPaneHandle {
  sendKeys: (keys: string) => { delivered: boolean; reason?: string };
  readLastOutput: (chars?: number) => string;
}

export interface TerminalPaneProps {
  onOutput?: (data: string) => void;
}

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
  const chunkCountRef = useRef(0);

  const onOutputRef = useRef(props.onOutput);
  useEffect(() => { onOutputRef.current = props.onOutput; }, [props.onOutput]);

  const aguiBridge = useTerminalAgui();
  const aguiRef = useRef(aguiBridge);
  useEffect(() => { aguiRef.current = aguiBridge; }, [aguiBridge]);

  const activeSessionRef = useRef<TerminalSession | null>(null);

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
  const [lastChunkAt, setLastChunkAt] = useState<number | null>(null);
  const [chunkCount, setChunkCount] = useState(0);

  const [modeOverride, setModeOverride] = useState<TerminalMode | null>(() => {
    if (typeof window === "undefined") return null;
    const v = window.localStorage.getItem(MODE_OVERRIDE_KEY);
    return v === "classic" || v === "agent" ? v : null;
  });
  const [autonomy, setAutonomy] = useState<AgentAutonomy>(() => {
    if (typeof window === "undefined") return "assist";
    const v = window.localStorage.getItem(AUTONOMY_KEY);
    return v === "manual" || v === "autonomous" ? v : "assist";
  });
  const [railCollapsed, setRailCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(RAIL_KEY) === "1";
  });
  const [timelineWidth, setTimelineWidth] = useState<number>(() => {
    if (typeof window === "undefined") return 300;
    const v = Number(window.localStorage.getItem(TIMELINE_WIDTH_KEY));
    return Number.isFinite(v) && v >= 220 && v <= 720 ? v : 300;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (modeOverride) window.localStorage.setItem(MODE_OVERRIDE_KEY, modeOverride);
    else window.localStorage.removeItem(MODE_OVERRIDE_KEY);
  }, [modeOverride]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(AUTONOMY_KEY, autonomy);
  }, [autonomy]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(RAIL_KEY, railCollapsed ? "1" : "0");
  }, [railCollapsed]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(TIMELINE_WIDTH_KEY, String(Math.round(timelineWidth)));
  }, [timelineWidth]);

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
  useEffect(() => { activeSessionRef.current = activeSession; }, [activeSession]);
  const activeSessionKey = activeSession
    ? `${activeSession.id}:${activeSession.startedAt}`
    : null;

  const mode: TerminalMode = modeOverride ?? defaultModeFor(activeSession);

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
    chunkCountRef.current = 0;
    setChunkCount(0);
    setLastChunkAt(null);
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

      const snapshot = activeSessionRef.current;
      let sessionProfileForBridge: TerminalProfile | undefined = snapshot?.profile;
      const sessionLabel = snapshot?.label ?? null;
      const sessionCwd = snapshot?.cwd ?? null;

      socket.addEventListener("open", () => {
        setSocketState("connected");
        if (sessionProfileForBridge) {
          aguiRef.current.start({
            sessionId: activeSessionId,
            profile: sessionProfileForBridge,
            label: sessionLabel,
            cwd: sessionCwd,
          });
        }
      });

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
          aguiRef.current.emit(activeSessionId, sessionProfileForBridge, message.data);

          chunkCountRef.current += 1;
          setChunkCount(chunkCountRef.current);
          setLastChunkAt(Date.now());

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
          if ("profile" in nextMeta && !sessionProfileForBridge) {
            sessionProfileForBridge = nextMeta.profile;
            if (sessionProfileForBridge) {
              aguiRef.current.start({
                sessionId: activeSessionId,
                profile: sessionProfileForBridge,
                label: "label" in nextMeta ? nextMeta.label ?? null : sessionLabel,
                cwd: "cwd" in nextMeta ? nextMeta.cwd ?? null : sessionCwd,
              });
            }
          }
          return;
        }
        if (message.type === "status") {
          setMeta((c) => ({ ...c, status: message.status }));
          return;
        }
        if (message.type === "exit") {
          setMeta((c) => ({ ...c, exitCode: message.exitCode }));
          aguiRef.current.end(activeSessionId, message.exitCode ?? null);
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
      if (activeSessionId) aguiRef.current.end(activeSessionId);
      socket?.close();
    };
  }, [activeSessionId, refresh, serviceOnline, write]);

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

  useShortcut("alt+n", () => void handleLaunch("shell"), {
    when: "no-input",
    label: "Terminal: new shell",
  });
  useShortcut(
    "alt+w",
    () => {
      if (activeSession) void handleDeleteSession(activeSession.id);
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
  useShortcut(
    "cmd+/",
    () => setModeOverride((prev) => {
      const next = (prev ?? defaultModeFor(activeSession)) === "classic" ? "agent" : "classic";
      return next;
    }),
    { when: "no-input", label: "Terminal: toggle classic / agent view" },
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
  const errorNotice = transportError || actionError || meta.error || error || null;
  const friendlyErrorNotice = errorNotice === "Unauthorized."
    ? "token mismatch · terminal relay is up but this browser session is not authenticated"
    : errorNotice;

  const { events: agentEvents, stepCount, tokenCount } = useAgentTimeline(
    activeSession,
    lastChunkAt,
    chunkCount,
  );

  const autoApprovePolicy = autonomy === "manual"
    ? "off"
    : autonomy === "assist"
      ? "read-only"
      : "all";

  // Inject the terminal screen into whichever layout is active. The screen
  // node itself (Terminal + WebSocket) must not remount when mode toggles —
  // both layouts receive the same memoized node.
  const screen = activeSession ? (
    <div
      className="tp2-screen"
      data-hotkeys-ignore="true"
      onMouseDownCapture={() => focusTerminalSoon(0)}
      onClick={() => focusTerminalSoon(0)}
    >
      <Terminal
        key={activeSessionKey}
        ref={ref}
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
  ) : (
    <EmptyScreen
      serviceOnline={serviceOnline}
      loading={loading}
      onLaunch={handleLaunch}
      refresh={refresh}
      error={friendlyErrorNotice}
    />
  );

  return (
    <section className="tp2-stage">
      <Topbar
        breadcrumb={{
          cwd: detailCwd,
          branch: null,
          mode,
        }}
        agentOn={mode === "agent" && detailStatus === "running"}
        autoApprove={autoApprovePolicy}
        onToggleMode={() => setModeOverride((prev) => {
          const next = (prev ?? defaultModeFor(activeSession)) === "classic" ? "agent" : "classic";
          return next;
        })}
      />
      <TabStrip
        sessions={sessions}
        activeId={activeSessionId}
        busy={busyAction !== null}
        canLaunch={serviceOnline}
        onSelect={handleSelectSession}
        onClose={handleDeleteSession}
        onNew={handleLaunch}
        onClear={outputBufferRef.current ? () => { outputBufferRef.current = ""; } : undefined}
      />

      {mode === "agent" ? (
        <TerminalAgent
          session={activeSession}
          status={detailStatus}
          autonomy={autonomy}
          onAutonomyChange={setAutonomy}
          threadId={activeSession ? `t_${activeSession.id.slice(0, 8)}` : null}
          stepCount={stepCount}
          tokenCount={tokenCount}
          events={agentEvents}
          footprint={{ artifacts: 0, writes: 0, net: 0 }}
          screen={screen}
          proposedCommand={null}
          timelineWidth={timelineWidth}
          onTimelineWidthChange={setTimelineWidth}
        />
      ) : (
        <TerminalClassic
          session={activeSession}
          status={detailStatus}
          pid={detailPid}
          screen={screen}
          railCollapsed={railCollapsed}
          onToggleRail={() => setRailCollapsed((v) => !v)}
        />
      )}

      <StatusBar
        left={[
          {
            key: "socket",
            label: socketState === "connected" ? "● connected" : socketState === "connecting" ? "◦ connecting" : socketState === "error" ? "✗ error" : "○ idle",
            tone: socketState === "error" ? "err" : socketState === "connected" ? "ok" : "dim",
          },
          ...(detailPid ? [{ key: "pid", label: `pid ${detailPid}` }] : []),
          {
            key: "sessions",
            label: `${sessions.length} session${sessions.length === 1 ? "" : "s"} · ${runningCount} live${staleCount > 0 ? ` · ${staleCount} exited` : ""}`,
            tone: "dim" as const,
          },
          ...(friendlyErrorNotice ? [{ key: "err", label: friendlyErrorNotice, tone: "err" as const }] : []),
        ]}
        right={[
          { key: "host", label: `${health?.host ?? "127.0.0.1"}:${health?.port ?? 4010}` },
          { key: "new", kbd: "⌥N", label: "new" },
          { key: "mode", kbd: "⌘/", label: "mode" },
        ]}
      />
    </section>
  );
});

function EmptyScreen({
  serviceOnline,
  loading,
  onLaunch,
  refresh,
  error,
}: {
  serviceOnline: boolean;
  loading: boolean;
  onLaunch: (profile: TerminalProfile) => void;
  refresh: () => void;
  error: string | null;
}) {
  return (
    <div className="tp2-empty">
      <div className="tp2-empty-mark">▶_</div>
      <div className="tp2-empty-title">{serviceOnline ? "New session" : "Terminal relay offline"}</div>
      <div className="tp2-empty-body">
        {serviceOnline
          ? "pick a starting point or press ⌥N to drop into a shell"
          : "waiting for the local terminal relay · check auth + sidecar"}
      </div>
      {serviceOnline ? (
        <div className="tp2-empty-options">
          <button type="button" className="tp2-opt" onClick={() => onLaunch("shell")}>
            <kbd className="tp2-kbd">⌥N</kbd>
            <span className="tp2-opt-title">local shell</span>
            <span className="tp2-opt-hint">zsh / bash / nu</span>
          </button>
          <button type="button" className="tp2-opt" onClick={() => onLaunch("claude")}>
            <span className="tp2-opt-glyph">✦</span>
            <span className="tp2-opt-title">Claude</span>
            <span className="tp2-opt-hint">agent session</span>
          </button>
          <button type="button" className="tp2-opt" onClick={() => onLaunch("opencode")}>
            <span className="tp2-opt-glyph">◆</span>
            <span className="tp2-opt-title">OpenCode</span>
            <span className="tp2-opt-hint">agent session</span>
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="tp2-opt tp2-opt--primary"
          onClick={refresh}
          disabled={loading}
        >
          {loading ? "syncing…" : "refresh status"}
        </button>
      )}
      {error && <div className="tp2-empty-error">{error}</div>}
    </div>
  );
}

export { compactPath };
