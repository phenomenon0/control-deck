"use client";

/* =============================================================================
   ATLAS VISUAL 2 — WORKSPACE. Hosts the real multi-pane WorkspaceShell (live
   pane bus, SSE command relay, full pane catalog) inside the v2 shell,
   re-themed from dockview's dark abyss into Atlas via the scoped `--dv-*`
   custom-property overrides in workspace-v2.css (release-QA decision A2 —
   this replaced a look-alike demo with hardcoded pane content).

   The provider stack mirrors what DeckShell gave the shell's panes (settings,
   threads, canvas, inspector, audio dock) minus the legacy chrome.
   ============================================================================= */

import dynamic from "next/dynamic";
import { DeckSettingsProvider } from "@/components/settings/DeckSettingsProvider";
import { ThreadManagerProvider } from "@/lib/hooks/useThreadManager";
import { CanvasProvider } from "@/lib/hooks/useCanvas";
import { ChatInspectorProvider } from "@/lib/hooks/useChatInspector";
import { AudioDockProvider } from "@/components/audio/AudioDockProvider";
import "./workspace-v2.css";

// Dockview touches `window` at module evaluation time, so the shell MUST be
// client-only. Dynamic import with ssr:false avoids the server trying to
// render it during initial page load.
const WorkspaceShell = dynamic(
  () => import("@/components/workspace/WorkspaceShell").then((m) => m.WorkspaceShell),
  {
    ssr: false,
    loading: () => <div style={{ padding: 24, opacity: 0.6 }}>Loading workspace…</div>,
  },
);

export default function WorkspaceV2Page() {
  return (
    <div className="av2-workspace">
      <DeckSettingsProvider>
        <ThreadManagerProvider>
          <CanvasProvider>
            <ChatInspectorProvider>
              <AudioDockProvider>
                <WorkspaceShell />
              </AudioDockProvider>
            </ChatInspectorProvider>
          </CanvasProvider>
        </ThreadManagerProvider>
      </DeckSettingsProvider>
    </div>
  );
}
