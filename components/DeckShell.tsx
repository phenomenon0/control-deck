"use client";

import { useShortcut } from "@/lib/hooks/useShortcuts";
import { DeckSettingsProvider } from "./settings/DeckSettingsProvider";
import { CanvasProvider, useCanvas } from "@/lib/hooks/useCanvas";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { ChatInspectorProvider } from "@/lib/hooks/useChatInspector";
import { ThreadManagerProvider } from "@/lib/hooks/useThreadManager";
import { PreflightGate } from "./preflight/PreflightGate";
import { AudioDockProvider } from "./audio/AudioDockProvider";
import { ApprovalPeek } from "./approvals/ApprovalPeek";
import { ThemeToggle } from "./theme/ThemeToggle";

/**
 * DeckShell — the provider stack for the deck.
 *
 * The v1 shell chrome (Sidebar, CommandPalette, SettingsDrawer, InspectorSheet,
 * right-rail) was retired when the v2 composed deck (/deck/all) became the single
 * surface — it brings its own DeckRail. Every legacy /deck/* route now redirects
 * to /deck/all, so the shell only needs to mount the providers the v2 surface and
 * onboarding depend on, plus the global overlays (ThemeToggle, ApprovalPeek).
 */

function CanvasKeyboardHandler({ children }: { children: React.ReactNode }) {
  const { toggle, isOpen } = useCanvas();

  useShortcut("mod+shift+c", () => toggle(), {
    when: "no-input",
    label: "Toggle canvas panel",
  });

  useShortcut("escape", () => toggle(), {
    enabled: isOpen,
    priority: 10,
    label: "Close canvas",
  });

  return <>{children}</>;
}

export function DeckShell({ children }: { children: React.ReactNode }) {
  return (
    <DeckSettingsProvider>
      <ThreadManagerProvider>
        <CanvasProvider>
          <CanvasKeyboardHandler>
            <ChatInspectorProvider>
              <PreflightGate>
                <AudioDockProvider>
                  <ErrorBoundary name="main-content">{children}</ErrorBoundary>
                  <ApprovalPeek />
                  <ThemeToggle />
                </AudioDockProvider>
              </PreflightGate>
            </ChatInspectorProvider>
          </CanvasKeyboardHandler>
        </CanvasProvider>
      </ThreadManagerProvider>
    </DeckSettingsProvider>
  );
}
