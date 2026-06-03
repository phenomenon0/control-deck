"use client";

/**
 * TerminalContainer — the deck-only brain that turns flat PTY sessions into a
 * tmux-style windows+panes UI. It owns the window model (each window is a split
 * tree of panes → sessions), reconciles client windows with the live session
 * list, drives keyboard shortcuts + ⌘-arrow spatial focus, and renders
 * TerminalChrome with a live renderPane. Eventually replaces
 * components/panes/TerminalPane.tsx.
 *
 * Window model:
 *  - On load, every externally-discovered session becomes its own window.
 *  - Splitting / new-window create sessions we place ourselves (manualIds) so the
 *    reconcile pass doesn't also spawn a window for them.
 *  - Closing a pane deletes its session; closing the last pane closes the window.
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import { useTerminalSessions } from "@/lib/hooks/useTerminalSessions";
import { useShortcut } from "@/lib/hooks/useShortcuts";
import type { TerminalSession } from "@/lib/terminal/types";

import { TerminalChrome } from "./TerminalChrome";
import { LiveTerminalScreen, type PaneHandle } from "./LiveTerminalScreen";
import type { TerminalProfile, TerminalStatusModel, TerminalTab } from "./terminalTypes";
import {
  allLeaves,
  closePane,
  firstLeaf,
  genPaneId,
  leafForSession,
  makeLeaf,
  pruneSessions,
  setPaneSession,
  setSizes,
  splitLeaf,
  type SplitNode,
} from "./splitTree";

const WINDOWS_KEY = "deck:terminal-v2-windows";

interface Win {
  id: string;
  layout: SplitNode;
}

export interface TerminalContainerHandle {
  sendKeys: (keys: string) => { delivered: boolean; reason?: string };
  readLastOutput: (chars?: number) => string;
}

function loadWindows(): { windows: Win[]; activeId: string | null } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(WINDOWS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { windows: Win[]; activeId: string | null };
    if (!Array.isArray(parsed.windows)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export const TerminalContainer = forwardRef<TerminalContainerHandle, { className?: string }>(
  function TerminalContainer({ className }, handleRef) {
    const { sessions, health, serviceOnline, refresh, createSession, restartSession, deleteSession } =
      useTerminalSessions();

    const cursors = useRef<Map<string, number>>(new Map());
    const registry = useRef<Map<string, PaneHandle>>(new Map());
    const manualIds = useRef<Set<string>>(new Set());
    // Sessions we've observed in a good (online) poll. A leaf is only pruned
    // when its session was SEEN here and is later confirmed gone — never for a
    // session that's merely pending (optimistic, not-yet-polled) or missing from
    // a transient/offline poll. This is what stopped tabs "deleting" on switch.
    const seen = useRef<Set<string>>(new Set());

    const hydrated = useRef(loadWindows());
    const [windows, setWindows] = useState<Win[]>(hydrated.current?.windows ?? []);
    const [activeId, setActiveId] = useState<string | null>(hydrated.current?.activeId ?? null);
    const [focusedByWindow, setFocusedByWindow] = useState<Record<string, string>>({});

    const windowsRef = useRef(windows);
    useEffect(() => {
      windowsRef.current = windows;
    }, [windows]);
    const activeIdRef = useRef(activeId);
    useEffect(() => {
      activeIdRef.current = activeId;
    }, [activeId]);

    const sessionById = useMemo(() => {
      const m = new Map<string, TerminalSession>();
      for (const s of sessions) m.set(s.id, s);
      return m;
    }, [sessions]);

    // Reconcile client windows with the live session list — ADDITIVELY.
    // Offline/failed polls report sessions=[] (see useTerminalSessions catch);
    // acting on those would wipe every tab. So: ignore polls while offline, and
    // prune a leaf only when its session was seen in a good poll AND is now gone.
    useEffect(() => {
      if (!serviceOnline) return;
      const live = new Set(sessions.map((s) => s.id));
      sessions.forEach((s) => seen.current.add(s.id));
      setWindows((prev) => {
        // Keep a session id if it's live OR still pending (never seen in a poll
        // yet — an optimistic create). Drop only seen-then-gone (real exits).
        const keep = new Set<string>();
        for (const w of prev)
          for (const leaf of allLeaves(w.layout))
            if (leaf.sessionId && (live.has(leaf.sessionId) || !seen.current.has(leaf.sessionId)))
              keep.add(leaf.sessionId);

        let next = prev
          .map((w) => ({ ...w, layout: pruneSessions(w.layout, keep) }))
          .filter((w): w is Win => w.layout !== null);

        const covered = new Set(
          next.flatMap((w) => allLeaves(w.layout).map((l) => l.sessionId).filter(Boolean) as string[]),
        );
        for (const s of sessions) {
          if (covered.has(s.id) || manualIds.current.has(s.id)) continue;
          next = [...next, { id: genPaneId(), layout: makeLeaf(s.id) }];
          covered.add(s.id);
        }
        return next;
      });
    }, [sessions, serviceOnline]);

    // Keep an active window selected.
    useEffect(() => {
      if (activeId && windows.some((w) => w.id === activeId)) return;
      setActiveId(windows[0]?.id ?? null);
    }, [windows, activeId]);

    // Persist windows + active id.
    useEffect(() => {
      if (typeof window === "undefined") return;
      window.localStorage.setItem(WINDOWS_KEY, JSON.stringify({ windows, activeId }));
    }, [windows, activeId]);

    const active = windows.find((w) => w.id === activeId) ?? null;
    const focusedPaneId = active
      ? focusedByWindow[active.id] ?? firstLeaf(active.layout).id
      : "";

    const setFocus = useCallback(
      (paneId: string) => {
        const id = activeIdRef.current;
        if (!id) return;
        setFocusedByWindow((m) => ({ ...m, [id]: paneId }));
        registry.current.get(paneId)?.focus();
      },
      [],
    );

    const patchActiveLayout = useCallback((fn: (l: SplitNode) => SplitNode) => {
      const id = activeIdRef.current;
      if (!id) return;
      setWindows((prev) => prev.map((w) => (w.id === id ? { ...w, layout: fn(w.layout) } : w)));
    }, []);

    // ── tab/window actions ──
    const onNewTab = useCallback(
      async (profile: TerminalProfile) => {
        try {
          const s = await createSession({ profile });
          manualIds.current.add(s.id);
          const id = genPaneId();
          const leaf = makeLeaf(s.id);
          setWindows((prev) => [...prev, { id, layout: leaf }]);
          setActiveId(id);
          setFocusedByWindow((m) => ({ ...m, [id]: leaf.id }));
        } catch {
          /* surfaced via status model error below */
        }
      },
      [createSession],
    );

    const onCloseTab = useCallback(
      (windowId: string) => {
        const w = windowsRef.current.find((x) => x.id === windowId);
        if (w) {
          for (const leaf of allLeaves(w.layout)) {
            if (leaf.sessionId) void deleteSession(leaf.sessionId);
          }
        }
        setWindows((prev) => prev.filter((x) => x.id !== windowId));
      },
      [deleteSession],
    );

    const onSplit = useCallback(
      async (paneId: string, dir: "row" | "col") => {
        const id = activeIdRef.current;
        const win = windowsRef.current.find((w) => w.id === id);
        if (!win || !id) return;
        try {
          const s = await createSession({ profile: "shell" });
          manualIds.current.add(s.id);
          const { tree, newPaneId } = splitLeaf(win.layout, paneId, dir, s.id);
          setWindows((prev) => prev.map((w) => (w.id === id ? { ...w, layout: tree } : w)));
          setFocusedByWindow((m) => ({ ...m, [id]: newPaneId }));
        } catch {
          /* ignore */
        }
      },
      [createSession],
    );

    const onClosePane = useCallback(
      (paneId: string) => {
        const id = activeIdRef.current;
        const win = windowsRef.current.find((w) => w.id === id);
        if (!win || !id) return;
        const leaf = allLeaves(win.layout).find((l) => l.id === paneId);
        if (leaf?.sessionId) void deleteSession(leaf.sessionId);
        const next = closePane(win.layout, paneId);
        if (next) {
          setWindows((prev) => prev.map((w) => (w.id === id ? { ...w, layout: next } : w)));
          setFocusedByWindow((m) => ({ ...m, [id]: firstLeaf(next).id }));
        } else {
          setWindows((prev) => prev.filter((w) => w.id !== id));
        }
      },
      [deleteSession],
    );

    const launchIntoPane = useCallback(
      async (paneId: string, profile: TerminalProfile) => {
        const id = activeIdRef.current;
        if (!id) return;
        try {
          const s = await createSession({ profile });
          manualIds.current.add(s.id);
          patchActiveLayout((l) => setPaneSession(l, paneId, s.id));
        } catch {
          /* ignore */
        }
      },
      [createSession, patchActiveLayout],
    );

    const restartPaneSession = useCallback(
      async (sessionId: string) => {
        try {
          const s = await restartSession(sessionId);
          // Re-point any leaf on the old id to the restarted id (id is stable here).
          if (s.id !== sessionId) {
            setWindows((prev) =>
              prev.map((w) => ({
                ...w,
                layout: pruneSessions(setPaneSessionEverywhere(w.layout, sessionId, s.id), new Set(sessions.map((x) => x.id).concat(s.id)))!,
              })),
            );
          }
        } catch {
          /* ignore */
        }
      },
      [restartSession, sessions],
    );

    // ── keyboard ──
    useShortcut("alt+n", () => void onNewTab("shell"), { when: "no-input", label: "Terminal: new window" });
    useShortcut("cmd+d", () => focusedPaneId && void onSplit(focusedPaneId, "row"), {
      when: "no-input",
      label: "Terminal: split right",
    });
    useShortcut("cmd+shift+d", () => focusedPaneId && void onSplit(focusedPaneId, "col"), {
      when: "no-input",
      label: "Terminal: split down",
    });
    useShortcut("alt+w", () => focusedPaneId && onClosePane(focusedPaneId), {
      when: "no-input",
      label: "Terminal: close pane",
    });
    const selectByIndex = useCallback((i: number) => {
      const w = windowsRef.current[i];
      if (w) setActiveId(w.id);
    }, []);
    useShortcut("alt+1", () => selectByIndex(0), { when: "no-input", label: "Terminal: window 1" });
    useShortcut("alt+2", () => selectByIndex(1), { when: "no-input", label: "Terminal: window 2" });
    useShortcut("alt+3", () => selectByIndex(2), { when: "no-input", label: "Terminal: window 3" });
    useShortcut("alt+4", () => selectByIndex(3), { when: "no-input", label: "Terminal: window 4" });
    useShortcut("alt+5", () => selectByIndex(4), { when: "no-input", label: "Terminal: window 5" });

    // ⌘+arrow spatial focus + ⌘+digit pane-jump now live in TerminalChrome (so
    // they work in Storybook too); the container just feeds focus → registry.

    // ── imperative handle (workspace adapter): route to the focused pane ──
    useImperativeHandle(
      handleRef,
      () => ({
        sendKeys: (keys: string) =>
          registry.current.get(focusedPaneId)?.sendKeys(keys) ?? {
            delivered: false,
            reason: "no active terminal pane",
          },
        readLastOutput: (chars?: number) => registry.current.get(focusedPaneId)?.readLastOutput(chars) ?? "",
      }),
      [focusedPaneId],
    );

    // ── derived chrome inputs ──
    const tabs: TerminalTab[] = windows.map((w) => {
      const focused = focusedByWindow[w.id] ?? firstLeaf(w.layout).id;
      const leaf = allLeaves(w.layout).find((l) => l.id === focused) ?? firstLeaf(w.layout);
      const s = leaf.sessionId ? sessionById.get(leaf.sessionId) : undefined;
      return {
        id: w.id,
        title: s?.label ?? (s ? s.profile : "shell"),
        profile: s?.profile ?? "shell",
        status: s?.status ?? "starting",
      };
    });

    const liveCount = sessions.filter((s) => s.status === "running").length;
    const status: TerminalStatusModel = {
      connection: !serviceOnline ? "error" : sessions.length === 0 ? "idle" : "connected",
      sessionCount: sessions.length,
      liveCount,
      host: health?.host ?? "127.0.0.1",
      port: health?.port ?? 4010,
      error: !serviceOnline ? "terminal relay offline" : null,
    };

    return (
      <div className="flex min-h-0 min-w-0 flex-1">
        <TerminalChrome
          className={className}
          sessionMeta={Object.fromEntries(sessions.map((s) => [s.id, { title: s.label ?? s.profile }]))}
          tabs={tabs}
          activeTabId={activeId}
          onSelectTab={(id) => {
            setActiveId(id);
            const w = windowsRef.current.find((x) => x.id === id);
            if (w) registry.current.get(focusedByWindow[id] ?? firstLeaf(w.layout).id)?.focus();
          }}
          onCloseTab={onCloseTab}
          onNewTab={onNewTab}
          canLaunch={serviceOnline}
          layout={active?.layout ?? null}
          windows={windows.map((w) => ({
            id: w.id,
            layout: w.layout,
            focusedPaneId: focusedByWindow[w.id] ?? firstLeaf(w.layout).id,
          }))}
          activeWindowId={activeId}
          focusedPaneId={focusedPaneId}
          onFocusPane={setFocus}
          onSplit={onSplit}
          onClosePane={onClosePane}
          onResize={(groupId, sizes) => patchActiveLayout((l) => setSizes(l, groupId, sizes))}
          status={status}
          renderPane={(leaf) => (
            <LiveTerminalScreen
              key={leaf.id}
              paneId={leaf.id}
              session={leaf.sessionId ? sessionById.get(leaf.sessionId) ?? null : null}
              serviceOnline={serviceOnline}
              cursors={cursors}
              registry={registry}
              onExit={() => void refresh()}
              onLaunch={(profile) => void launchIntoPane(leaf.id, profile)}
              onRestart={() => leaf.sessionId && void restartPaneSession(leaf.sessionId)}
            />
          )}
        />
      </div>
    );
  },
);

/** Replace a session id on every leaf that references it (used on restart). */
function setPaneSessionEverywhere(node: SplitNode, fromId: string, toId: string): SplitNode {
  if (node.type === "leaf") return node.sessionId === fromId ? { ...node, sessionId: toId } : node;
  return { ...node, children: node.children.map((c) => setPaneSessionEverywhere(c, fromId, toId)) };
}

export default TerminalContainer;
