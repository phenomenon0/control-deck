"use client";

/**
 * AudioPane — Audio surface split into Live / Voices / Studio / Health.
 *
 * Active tab + selected asset + highlighted job are URL-persisted through
 * `useVoiceWorkspace`, so sub-panes can deep-link into each other via
 * `jumpToStudio`, `jumpToVoices`, `jumpToLive`, `jumpToHealth`. Old URLs
 * (`?tab=assistant`, `?tab=library`) are aliased to `live`/`voices`.
 */

import dynamic from "next/dynamic";
import { Suspense, type ComponentType } from "react";
import { AssistantSurface } from "@/components/voice-assistant/AssistantSurface";
import { useVoiceWorkspace, type VoiceTab } from "@/lib/hooks/useVoiceWorkspace";

const StudioPane = dynamic(
  () => import("@/components/voice-studio/StudioPane").then((m) => m.StudioPane),
  { ssr: false, loading: () => <div className="p-6 text-sm text-[var(--text-muted)]">Loading…</div> },
);

const LibraryPane = dynamic(
  () => import("@/components/voice-library/LibraryPane").then((m) => m.LibraryPane),
  { ssr: false, loading: () => <div className="p-6 text-sm text-[var(--text-muted)]">Loading…</div> },
);

const VoiceHealthPane = dynamic(
  () => import("@/components/voice-health/VoiceHealthPane").then((m) => m.VoiceHealthPane),
  { ssr: false, loading: () => <div className="p-6 text-sm text-[var(--text-muted)]">Loading…</div> },
);

interface TabDef {
  id: VoiceTab;
  label: string;
  Component: ComponentType;
}

const TABS: readonly TabDef[] = [
  { id: "live", label: "Live", Component: AssistantSurface },
  { id: "voices", label: "Voices", Component: LibraryPane },
  { id: "studio", label: "Studio", Component: StudioPane },
  { id: "health", label: "Health", Component: VoiceHealthPane },
];

function AudioPaneInner() {
  const { tab, setTab } = useVoiceWorkspace();
  const ActiveComponent = TABS.find((t) => t.id === tab)?.Component ?? AssistantSurface;

  return (
    <div className="h-full flex flex-col">
      <div className="control-tabbar">
        {TABS.map((t) => {
          const isActive = t.id === tab;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`control-tab${isActive ? " control-tab--active" : ""}`}
              aria-pressed={isActive}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div className="flex-1 overflow-hidden">
        <ActiveComponent />
      </div>
    </div>
  );
}

export function AudioPane() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-[var(--text-muted)]">Loading…</div>}>
      <AudioPaneInner />
    </Suspense>
  );
}
