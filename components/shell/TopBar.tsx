"use client";

import { usePathname } from "next/navigation";
import { PanelRight } from "lucide-react";

const TITLES: Record<string, string> = {
  "/deck": "Dashboard",
  "/deck/chat": "Chat",
  "/deck/runs": "Runs",
  "/deck/models": "Models",
  "/deck/dojo": "Dojo",
  "/deck/tools": "Tools",
  "/deck/comfy": "Comfy",
  "/deck/voice": "Voice",
  "/deck/agentgo": "AgentGo",
};

function resolveTitle(pathname: string): string {
  if (TITLES[pathname]) return TITLES[pathname];
  // Match prefix for nested routes like /deck/chat/123
  for (const [route, title] of Object.entries(TITLES)) {
    if (route !== "/deck" && pathname.startsWith(route + "/")) return title;
  }
  return "Control Deck";
}

interface TopBarProps {
  onOpenPalette: () => void;
  onToggleInspector: () => void;
  inspectorOpen: boolean;
}

export function TopBar({ onOpenPalette, onToggleInspector, inspectorOpen }: TopBarProps) {
  const pathname = usePathname();
  const title = resolveTitle(pathname);

  return (
    <header className="deck-header">
      {/* Left: Page title */}
      <div className="deck-header-left">
        <span className="deck-header-title">{title}</span>
      </div>

      {/* Right: actions */}
      <div className="deck-header-right">
        <button
          onClick={onOpenPalette}
          className="deck-header-btn"
          title="Search (Cmd+K)"
        >
          <kbd className="kbd">K</kbd>
        </button>
        <button
          onClick={onToggleInspector}
          className={`deck-header-btn${inspectorOpen ? " active" : ""}`}
          title="Toggle inspector (Cmd+I)"
        >
          <PanelRight size={16} />
        </button>
      </div>
    </header>
  );
}
