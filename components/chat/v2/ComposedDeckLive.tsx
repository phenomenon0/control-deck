"use client";

/**
 * ComposedDeckLive — the WHOLE v2 composed deck as the real surface, wired live.
 *
 * The Slack-style DeckRail (canon per-family icons) + the live pane containers:
 *   chat      → ChatSurfaceV2   (real useAgentRun stream)
 *   terminal  → TerminalContainer (real PTY via terminal-service)
 *   comfy     → ComfyDeckV2      (real comfy fetches)
 *   settings  → SettingsSurface
 *   workspace → placeholder (v2 not built yet)
 *
 * Mounted at /deck/all; DeckShell bypasses its own chrome for that route (see
 * DeckShellInner), so this rail IS the deck's nav — and it inherits the deck
 * providers (DeckSettings / ThreadManager / Canvas) from DeckShell.
 */

import { useCallback, useState } from "react";

import { DeckRail, type DeckRailItem } from "./DeckRail";
import { KeepAliveStack, type KeepAliveItem } from "./KeepAliveStack";
import { PANE_LABELS, getPaneIcons } from "./paneIcons";
import ChatSurfaceV2 from "./ChatSurfaceV2";
import { TerminalContainer } from "./TerminalContainer";
import ComfyDeckV2 from "@/components/comfy/v2/ComfyDeckV2";
import { SettingsSurface } from "@/components/settings/v2/SettingsSurface";

function deckTheme(): string {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme || "dark";
}

export function ComposedDeckLive() {
  const [pane, setPane] = useState<string>("chat");
  const select = useCallback((id: string) => setPane(id), []);

  const map = getPaneIcons(deckTheme());
  const items: DeckRailItem[] = PANE_LABELS.map(([id, label]) => ({ id, label, icon: map[id] }));
  const footer: DeckRailItem[] = [{ id: "settings", label: "Settings", icon: map.settings }];

  // Keep-alive via KeepAliveStack: each pane mounts on first visit and then
  // stays mounted but hidden via `visibility` (NOT display:none). Crucially this
  // keeps the Terminal subtree at its real size when you're on another pane — a
  // display:none ancestor would collapse every terminal to 0×0 and wterm would
  // mangle the text. Also preserves the chat stream, PTY sockets, and comfy
  // iframe across navigation.
  const panes: KeepAliveItem[] = [
    { id: "chat", node: <ChatSurfaceV2 /> },
    { id: "terminal", node: <TerminalContainer /> },
    { id: "comfy", node: <ComfyDeckV2 /> },
    { id: "settings", node: <SettingsSurface /> },
  ];

  return (
    <div className="flex h-screen min-h-0 w-full" style={{ background: "var(--bg)" }}>
      <DeckRail items={items} footerItems={footer} activeId={pane} onSelect={select} />
      <KeepAliveStack items={panes} activeId={pane} />
    </div>
  );
}

export default ComposedDeckLive;
