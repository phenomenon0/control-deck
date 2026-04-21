"use client";

/**
 * AudioPane — 4th surface, music/audio. Tabs: Voice (conversational),
 * Live (audio streams / playback). URL-persisted via `?tab=`.
 */

import dynamic from "next/dynamic";
import { Suspense, useCallback, type ComponentType } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { VoicePane } from "@/components/panes/VoicePane";

// LivePane uses Web Audio — browser-only.
const LivePane = dynamic(
  () => import("@/components/panes/live/LivePane").then((m) => m.LivePane),
  { ssr: false, loading: () => <div className="p-6 text-sm text-[var(--text-muted)]">Loading…</div> },
);

type TabId = "voice" | "live";

interface TabDef {
  id: TabId;
  label: string;
  Component: ComponentType;
}

const TABS: readonly TabDef[] = [
  { id: "voice", label: "Voice", Component: VoicePane },
  { id: "live", label: "Live", Component: LivePane },
];

function AudioPaneInner() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const raw = params.get("tab");
  const active: TabId = (TABS.find((t) => t.id === raw)?.id ?? "voice");

  const setTab = useCallback(
    (id: TabId) => {
      const sp = new URLSearchParams(params.toString());
      if (id === "voice") {
        sp.delete("tab");
      } else {
        sp.set("tab", id);
      }
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, router, pathname]
  );

  const ActiveComponent = TABS.find((t) => t.id === active)!.Component;

  return (
    <div className="h-full flex flex-col">
      <div className="control-tabbar">
        {TABS.map((tab) => {
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setTab(tab.id)}
              className={`control-tab${isActive ? " control-tab--active" : ""}`}
              aria-pressed={isActive}
            >
              {tab.label}
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
