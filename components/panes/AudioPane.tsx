"use client";

/**
 * AudioPane — Audio surface, wireframes v3 layout.
 *
 * Modality tabs (left of the bar): Conductor (orb-centric live), Newsroom
 * (audio → styled document), Stage (multi-voice cast under spotlight), Tape
 * (DAW-style multitrack), Forum (parallel multi-agent columns). Utility
 * tabs (right of the bar): Voices, Studio, Health.
 *
 * Active tab + asset + job are URL-persisted via `useVoiceWorkspace`. Old
 * `?tab=live` / `?tab=assistant` redirect to `conductor`; `?tab=library`
 * redirects to `voices`.
 */

import dynamic from "next/dynamic";
import { Suspense, type ComponentType } from "react";
import { ConductorSurface } from "@/components/voice-conductor/ConductorSurface";
import { useVoiceWorkspace, type VoiceTab } from "@/lib/hooks/useVoiceWorkspace";

const NewsroomSurface = dynamic(
  () => import("@/components/voice-newsroom/NewsroomSurface").then((m) => m.NewsroomSurface),
  { ssr: false, loading: () => <div className="p-6 text-sm text-[var(--text-muted)]">Loading…</div> },
);

const StageSurface = dynamic(
  () => import("@/components/voice-stage/StageSurface").then((m) => m.StageSurface),
  { ssr: false, loading: () => <div className="p-6 text-sm text-[var(--text-muted)]">Loading…</div> },
);

const TapeSurface = dynamic(
  () => import("@/components/voice-tape/TapeSurface").then((m) => m.TapeSurface),
  { ssr: false, loading: () => <div className="p-6 text-sm text-[var(--text-muted)]">Loading…</div> },
);

const ForumSurface = dynamic(
  () => import("@/components/voice-forum/ForumSurface").then((m) => m.ForumSurface),
  { ssr: false, loading: () => <div className="p-6 text-sm text-[var(--text-muted)]">Loading…</div> },
);

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
  { id: "conductor", label: "Conductor", Component: ConductorSurface },
  { id: "newsroom",  label: "Newsroom",  Component: NewsroomSurface  },
  { id: "stage",     label: "Stage",     Component: StageSurface     },
  { id: "tape",      label: "Tape",      Component: TapeSurface      },
  { id: "forum",     label: "Forum",     Component: ForumSurface     },
  { id: "voices",    label: "Voices",    Component: LibraryPane      },
  { id: "studio",    label: "Studio",    Component: StudioPane       },
  { id: "health",    label: "Health",    Component: VoiceHealthPane  },
];

function AudioPaneInner() {
  const { tab, setTab } = useVoiceWorkspace();
  const ActiveComponent = TABS.find((t) => t.id === tab)?.Component ?? ConductorSurface;

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
