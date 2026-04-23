"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
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
import { InspectorSheet } from "./InspectorSheet";
import { ThreadSidebar } from "./chat/ThreadSidebar";
import { Icon } from "@/components/warp/Icons";
import { useDeckSettings } from "./settings/DeckSettingsProvider";
import { PreflightGate } from "./preflight/PreflightGate";

function DeckShellInner({ children }: { children: React.ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const isChat = pathname === "/deck/chat" || pathname.startsWith("/deck/chat/");
  const showThreads = isChat;
  const canvas = useCanvas();
  const { prefs } = useDeckSettings();

  useShortcut("mod+k", () => setPaletteOpen((o) => !o), {
    when: "no-input",
    label: "Toggle command palette",
  });

  useShortcut("mod+i", () => setInspectorOpen((o) => !o), {
    when: "no-input",
    label: "Toggle inspector",
  });

  useShortcut("escape", () => setInspectorOpen(false), {
    enabled: inspectorOpen,
    priority: 20,
    label: "Close inspector",
  });

  useShortcut("1", () => router.push("/deck/chat"), {
    when: "no-input",
    label: "Go to Chat",
  });
  useShortcut("2", () => router.push("/deck/terminal"), {
    when: "no-input",
    label: "Go to Terminal",
  });
  useShortcut("3", () => router.push("/deck/visual"), {
    when: "no-input",
    label: "Go to Visual",
  });
  useShortcut("4", () => router.push("/deck/audio"), {
    when: "no-input",
    label: "Go to Audio",
  });
  useShortcut("5", () => router.push("/deck/models"), {
    when: "no-input",
    label: "Go to Models",
  });
  useShortcut("6", () => router.push("/deck/control"), {
    when: "no-input",
    label: "Go to Control",
  });
  useShortcut("7", () => router.push("/deck/workspace"), {
    when: "no-input",
    label: "Go to Workspace",
  });
  useShortcut("8", () => router.push("/deck/capabilities"), {
    when: "no-input",
    label: "Go to Capabilities",
  });
  useShortcut("9", () => router.push("/deck/hardware"), {
    when: "no-input",
    label: "Go to Hardware",
  });
  useShortcut("0", () => router.push("/deck/settings"), {
    when: "no-input",
    label: "Go to Settings",
  });

  return (
    <div
      className={`app ${showThreads ? "app--chat" : "app--compact"} ${
        showThreads && prefs.chatContextRail ? "app--chat-context" : ""
      }`}
    >
      <Sidebar onOpenPalette={() => setPaletteOpen(true)} />

      {showThreads && <ThreadSidebar />}

      <main className="main">
        <ErrorBoundary name="main-content">{children}</ErrorBoundary>
      </main>
      <ErrorBoundary name="canvas">
        <div className="canvas-panel-host">
          <CanvasPanel />
        </div>
      </ErrorBoundary>

      <div className="right-rail" aria-label="Right pane controls">
        <button
          className={`right-rail-btn ${inspectorOpen ? "on" : ""}`}
          onClick={() => setInspectorOpen((open) => !open)}
          title="Inspector"
        >
          <Icon.Grid size={15} />
          <span>Inspect</span>
        </button>
        <button
          className={`right-rail-btn ${canvas.isOpen ? "on" : ""}`}
          onClick={canvas.toggle}
          title="Canvas"
        >
          <Icon.Box size={15} />
          <span>Canvas</span>
        </button>
      </div>

      <ErrorBoundary name="inspector">
        <InspectorSheet
          open={inspectorOpen}
          onClose={() => setInspectorOpen(false)}
        />
      </ErrorBoundary>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <SettingsDrawer />
    </div>
  );
}

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
                <DeckShellInner>{children}</DeckShellInner>
              </PreflightGate>
            </ChatInspectorProvider>
          </CanvasKeyboardHandler>
        </CanvasProvider>
      </ThreadManagerProvider>
    </DeckSettingsProvider>
  );
}
