"use client";

/**
 * usePaneSession — one live PTY connection for one split pane.
 *
 * Lifted (and trimmed) from components/panes/TerminalPane.tsx: the WebSocket
 * lifecycle, the per-session UTF-8 byte cursor (`?since=` resume so switching
 * panes/windows replays from the tail, not the whole history), the ready-buffer
 * for output that arrives before wterm mounts, the CPR write-patch (flush wterm's
 * host responses immediately so prompt probes don't leak as typed text), and
 * reset/meta/exit handling. The agent/agui bridge is intentionally dropped.
 *
 * Each visible pane calls this independently, so splits are N independent
 * terminals. The byte-cursor Map is owned by the container and passed in so it
 * survives a pane unmount/remount across window switches.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTerminal, type WTerm } from "@wterm/react";
import { getTerminalWebSocketUrl } from "@/lib/terminal/client";
import { isUsableTerminalSize } from "./paneFit";
import type {
  TerminalMetaMessage,
  TerminalServerMessage,
  TerminalSession,
  TerminalSessionStatus,
} from "@/lib/terminal/types";
import type { TerminalConnState } from "./terminalTypes";

const OUTPUT_BUFFER_MAX = 64_000;

type SocketState = "disconnected" | "connecting" | "connected" | "error";

interface SessionMetaState {
  cwd?: string;
  pid?: number | null;
  label?: string;
  status?: TerminalSessionStatus;
  exitCode?: number | null;
  error?: string | null;
}

export interface UsePaneSessionOptions {
  serviceOnline: boolean;
  /** Container-owned per-session byte cursor map (survives pane remounts). */
  cursors: React.MutableRefObject<Map<string, number>>;
  /** Fired when the PTY exits, so the container can refresh the session list. */
  onExit?: () => void;
}

export interface PaneSessionApi {
  /** Pass to <Terminal ref=…>. */
  ref: ReturnType<typeof useTerminal>["ref"];
  /** Stable key for <Terminal key=…> — changes on restart to force remount. */
  sessionKey: string | null;
  state: TerminalConnState;
  exitCode: number | null;
  errorText: string | null;
  cwd: string | null;
  pid: number | null;
  onReady: (wt?: WTerm) => void;
  onData: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
  sendInput: (data: string) => void;
  sendKeys: (keys: string) => { delivered: boolean; reason?: string };
  readLastOutput: (chars?: number) => string;
  focus: () => void;
  clear: () => void;
}

export function usePaneSession(
  session: TerminalSession | null,
  { serviceOnline, cursors, onExit }: UsePaneSessionOptions,
): PaneSessionApi {
  const { ref, write, focus } = useTerminal();
  const socketRef = useRef<WebSocket | null>(null);
  const terminalReadyRef = useRef(false);
  const pendingOutputRef = useRef<string[]>([]);
  const outputBufferRef = useRef<string>("");
  const byteEncoderRef = useRef<TextEncoder | null>(null);

  const [socketState, setSocketState] = useState<SocketState>("disconnected");
  const [transportError, setTransportError] = useState<string | null>(null);
  const [meta, setMeta] = useState<SessionMetaState>({});

  const sessionId = session?.id ?? null;
  const sessionKey = session ? `${session.id}:${session.startedAt}` : null;

  const onExitRef = useRef(onExit);
  useEffect(() => {
    onExitRef.current = onExit;
  }, [onExit]);

  // Reset ready/buffer + seed meta whenever the session (or its restart) changes.
  useEffect(() => {
    terminalReadyRef.current = false;
    pendingOutputRef.current = [];
    outputBufferRef.current = "";
    // A freshly (re)mounted pane has a BLANK wterm — e.g. splitting wraps this
    // leaf in a new group and React remounts it. Reset the byte cursor so the
    // next connect replays the FULL buffer and rebuilds the screen, instead of
    // resuming from a stale tail offset (which leaves the pane empty — the "text
    // disappears on split" bug). Tab-switch keep-alive never remounts, so this
    // only fires on real (re)mounts / session restarts.
    if (session) cursors.current.set(session.id, 0);
    setMeta(
      session
        ? {
            cwd: session.cwd,
            pid: session.pid,
            label: session.label,
            status: session.status,
            exitCode: session.exitCode,
            error: session.error,
          }
        : {},
    );
  }, [sessionKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // WebSocket lifecycle.
  useEffect(() => {
    if (!serviceOnline || !sessionId) {
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
        const since = cursors.current.get(sessionId) ?? 0;
        wsUrl = await getTerminalWebSocketUrl(sessionId, { since });
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
          cursors.current.set(sessionId, (cursors.current.get(sessionId) ?? 0) + bytes);
          if (terminalReadyRef.current) write(message.data);
          else pendingOutputRef.current.push(message.data);
          return;
        }
        if (message.type === "reset") {
          outputBufferRef.current = "";
          cursors.current.set(sessionId, 0);
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
            label: "label" in m ? m.label : c.label,
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
          setMeta((c) => ({ ...c, exitCode: message.exitCode, status: "exited" }));
          onExitRef.current?.();
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
  }, [sessionId, sessionKey, serviceOnline, cursors, write]);

  const sendInput = useCallback((data: string) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "input", data }));
    }
  }, []);

  const onResize = useCallback((cols: number, rows: number) => {
    // Drop degenerate sizes (a 0×0 container collapses toward 1×1) so a transient
    // bad measurement never reaches the PTY and corrupts the terminal buffer.
    if (!isUsableTerminalSize(cols, rows)) return;
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "resize", cols, rows }));
    }
  }, []);

  const onReady = useCallback(
    (wt?: WTerm) => {
      // Flush wterm's host responses (CPR etc.) immediately after writes so a
      // shell's ESC[6n probe doesn't time out and leak as visible ^[[5;1R text.
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
      window.setTimeout(() => focus(), 0);
    },
    [write, focus],
  );

  const sendKeys = useCallback((keys: string) => {
    const sock = socketRef.current;
    if (!sock || sock.readyState !== WebSocket.OPEN) {
      return { delivered: false, reason: "no active terminal session" };
    }
    sock.send(JSON.stringify({ type: "input", data: keys }));
    return { delivered: true };
  }, []);

  const readLastOutput = useCallback(
    (chars = 4000) => outputBufferRef.current.slice(-Math.min(chars, OUTPUT_BUFFER_MAX)),
    [],
  );

  const clear = useCallback(() => {
    outputBufferRef.current = "";
    if (terminalReadyRef.current) write("\x1b[2J\x1b[H\x1b[3J");
  }, [write]);

  const state: TerminalConnState = useMemo(() => {
    if (!session) return "empty";
    if (meta.status === "exited") return "exited";
    if (meta.status === "error" || socketState === "error") return "error";
    if (socketState === "connecting" || socketState === "disconnected") return "connecting";
    return "running";
  }, [session, meta.status, socketState]);

  return {
    ref,
    sessionKey,
    state,
    exitCode: meta.exitCode ?? null,
    errorText: transportError || meta.error || null,
    cwd: meta.cwd ?? session?.cwd ?? null,
    pid: meta.pid ?? session?.pid ?? null,
    onReady,
    onData: sendInput,
    onResize,
    sendInput,
    sendKeys,
    readLastOutput,
    focus,
    clear,
  };
}
