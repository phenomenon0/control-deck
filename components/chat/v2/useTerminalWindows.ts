"use client";

/**
 * useTerminalWindows — the single shared harness for terminal windows + tabs +
 * splits state, so stories don't each re-implement it (was duplicated in
 * TerminalChrome.stories and the rail layout). Drives a faux/live TerminalChrome:
 *
 *   const t = useTerminalWindows(initial);
 *   <TerminalChrome {...t} renderPane={…} status={…} />
 *
 * A *window* (tab) owns one split tree; splitting/new mint fresh pane+session
 * ids. Pure, deterministic ids (counter ref) so it's test-stable.
 */

import { useCallback, useRef, useState } from "react";
import { closePane, firstLeaf, makeLeaf, setSizes, splitLeaf, type SplitNode } from "./splitTree";
import type { TerminalProfile, TerminalTab } from "./terminalTypes";

export interface TermWindow {
  id: string;
  title: string;
  profile: TerminalProfile;
  layout: SplitNode;
}

export interface TerminalWindowsApi {
  tabs: TerminalTab[];
  activeTabId: string | null;
  focusedPaneId: string;
  layout: SplitNode | null;
  /** Keep-alive: every window's split tree (inactive ones render hidden). */
  windows: Array<{ id: string; layout: SplitNode; focusedPaneId: string }>;
  activeWindowId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: (profile: TerminalProfile) => void;
  onSplit: (paneId: string, dir: "row" | "col") => void;
  onClosePane: (paneId: string) => void;
  onResize: (groupId: string, sizes: number[]) => void;
  onFocusPane: (id: string) => void;
}

const DEFAULT_WINDOWS = (): TermWindow[] => [
  { id: "w1", title: "zsh", profile: "shell", layout: makeLeaf("s1") },
];

export function useTerminalWindows(initial?: TermWindow[]): TerminalWindowsApi {
  const counter = useRef(2);
  const seed = useRef<TermWindow[]>(initial ?? DEFAULT_WINDOWS()).current;
  const [wins, setWins] = useState<TermWindow[]>(seed);
  const [activeId, setActiveId] = useState<string | null>(seed[0]?.id ?? null);
  const [focused, setFocused] = useState<string>(seed[0] ? firstLeaf(seed[0].layout).id : "");

  // Refs so callbacks read current state without stale closures / deps churn.
  const winsRef = useRef(wins);
  winsRef.current = wins;
  const activeRef = useRef(activeId);
  activeRef.current = activeId;
  const next = () => counter.current++;
  const activeWin = () => winsRef.current.find((w) => w.id === activeRef.current) ?? null;

  const onSelectTab = useCallback((id: string) => {
    setActiveId(id);
    const w = winsRef.current.find((x) => x.id === id);
    if (w) setFocused(firstLeaf(w.layout).id);
  }, []);

  const onCloseTab = useCallback((id: string) => {
    const rest = winsRef.current.filter((w) => w.id !== id);
    setWins(rest);
    if (activeRef.current === id) {
      setActiveId(rest[0]?.id ?? null);
      if (rest[0]) setFocused(firstLeaf(rest[0].layout).id);
    }
  }, []);

  const onNewTab = useCallback((profile: TerminalProfile) => {
    const m = next();
    const id = `w${m}`;
    const leaf = makeLeaf(`s${m}`);
    setWins((p) => [...p, { id, title: profile === "shell" ? "zsh" : profile, profile, layout: leaf }]);
    setActiveId(id);
    setFocused(leaf.id);
  }, []);

  const onSplit = useCallback((paneId: string, dir: "row" | "col") => {
    const win = activeWin();
    if (!win) return;
    const { tree, newPaneId } = splitLeaf(win.layout, paneId, dir, `s${next()}`);
    setWins((p) => p.map((w) => (w.id === win.id ? { ...w, layout: tree } : w)));
    setFocused(newPaneId);
  }, []);

  const onClosePane = useCallback((paneId: string) => {
    const win = activeWin();
    if (!win) return;
    const tree = closePane(win.layout, paneId);
    if (tree) {
      setWins((p) => p.map((w) => (w.id === win.id ? { ...w, layout: tree } : w)));
      setFocused(firstLeaf(tree).id);
    } else {
      onCloseTab(win.id);
    }
  }, [onCloseTab]);

  const onResize = useCallback((groupId: string, sizes: number[]) => {
    const win = activeWin();
    if (!win) return;
    setWins((p) => p.map((w) => (w.id === win.id ? { ...w, layout: setSizes(w.layout, groupId, sizes) } : w)));
  }, []);

  const active = wins.find((w) => w.id === activeId) ?? null;
  const tabs: TerminalTab[] = wins.map((w) => ({ id: w.id, title: w.title, profile: w.profile, status: "running" }));

  return {
    tabs,
    activeTabId: activeId,
    focusedPaneId: focused,
    layout: active?.layout ?? null,
    windows: wins.map((w) => ({
      id: w.id,
      layout: w.layout,
      focusedPaneId: w.id === activeId ? focused : firstLeaf(w.layout).id,
    })),
    activeWindowId: activeId,
    onSelectTab,
    onCloseTab,
    onNewTab,
    onSplit,
    onClosePane,
    onResize,
    onFocusPane: setFocused,
  };
}
