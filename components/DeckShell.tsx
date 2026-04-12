"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useShortcut } from "@/lib/hooks/useShortcuts";
import { CommandPalette } from "./CommandPalette";
import { DeckSettingsProvider } from "./settings/DeckSettingsProvider";
import { SettingsDrawer } from "./settings/SettingsDrawer";
import { CanvasProvider, useCanvas } from "@/lib/hooks/useCanvas";
import { CanvasPanel } from "./canvas/CanvasPanel";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { ChatInspectorProvider } from "@/lib/hooks/useChatInspector";
import { ThreadManagerProvider } from "@/lib/hooks/useThreadManager";
import { Sidebar } from "./shell/Sidebar";
import { TopBar } from "./shell/TopBar";
import { InspectorSheet } from "./InspectorSheet";
import { ThreadSidebar } from "./chat/ThreadSidebar";

// =============================================================================
// Inner Shell (needs context)
// =============================================================================

function DeckShellInner({ children }: { children: React.ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const pathname = usePathname();
  const isChat = pathname === "/deck/chat" || pathname.startsWith("/deck/chat/");

  useShortcut("mod+k", () => setPaletteOpen((o) => !o), {
    label: "Toggle command palette",
  });

  useShortcut("mod+i", () => setInspectorOpen((o) => !o), {
    label: "Toggle inspector",
  });

  useShortcut("escape", () => setInspectorOpen(false), {
    enabled: inspectorOpen,
    priority: 20,
    label: "Close inspector",
  });

  return (
    <div className="deck-shell">
      {/* Left sidebar */}
      <Sidebar onOpenPalette={() => setPaletteOpen(true)} />

      {/* Thread sidebar — shell-level, visible only on /deck/chat (DESIGN.md §4) */}
      {isChat && <ThreadSidebar />}

      {/* Right: header + main content */}
      <div className="deck-body">
        <TopBar
          onOpenPalette={() => setPaletteOpen(true)}
          onToggleInspector={() => setInspectorOpen((o) => !o)}
          inspectorOpen={inspectorOpen}
        />

        <div className="deck-content">
          <main className="deck-main">
            <ErrorBoundary name="main-content">{children}</ErrorBoundary>
          </main>
          <ErrorBoundary name="canvas">
            <CanvasPanel />
          </ErrorBoundary>
        </div>
      </div>

      {/* Inspector slide-over sheet */}
      <ErrorBoundary name="inspector">
        <InspectorSheet
          open={inspectorOpen}
          onClose={() => setInspectorOpen(false)}
        />
      </ErrorBoundary>

      {/* Overlays */}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <SettingsDrawer />
    </div>
  );
}

// =============================================================================
// Canvas Wrapper (for keyboard shortcut)
// =============================================================================

function CanvasKeyboardHandler({ children }: { children: React.ReactNode }) {
  const { toggle, isOpen } = useCanvas();

  useShortcut("mod+shift+c", () => toggle(), {
    label: "Toggle canvas panel",
  });

  useShortcut("escape", () => toggle(), {
    enabled: isOpen,
    priority: 10,
    label: "Close canvas",
  });

  return <>{children}</>;
}

// =============================================================================
// Outer Shell (provides context)
// =============================================================================

export function DeckShell({ children }: { children: React.ReactNode }) {
  return (
    <DeckSettingsProvider>
      <ThreadManagerProvider>
        <CanvasProvider>
          <CanvasKeyboardHandler>
            <ChatInspectorProvider>
              <DeckShellInner>{children}</DeckShellInner>
            </ChatInspectorProvider>
          </CanvasKeyboardHandler>
        </CanvasProvider>
      </ThreadManagerProvider>
    </DeckSettingsProvider>
  );
}
