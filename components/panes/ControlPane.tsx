"use client";

/**
 * ControlPane — 5th surface, a tabbed dashboard unifying Runs, Tools,
 * UI Studio (née DoJo), AgentGo, and Models. The default tab is Runs,
 * which acts as a blended overview of activity across the other tabs.
 *
 * Tabs are URL-persisted via `?tab=`.
 */

import { Suspense, useCallback, type ComponentType } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { RunsPane } from "@/components/panes/RunsPane";
import { ToolsPane } from "@/components/panes/ToolsPane";
import { ModelsPane } from "@/components/panes/ModelsPane";
import { DojoPane } from "@/components/dojo";
import { AgentGoPane } from "@/components/panes/AgentGoPane";

type TabId = "runs" | "tools" | "studio" | "agentgo" | "models";

interface TabDef {
  id: TabId;
  label: string;
  Component: ComponentType;
}

const TABS: readonly TabDef[] = [
  { id: "runs", label: "Runs", Component: RunsPane },
  { id: "tools", label: "Tools", Component: ToolsPane },
  { id: "studio", label: "UI Studio", Component: DojoPane },
  { id: "agentgo", label: "Agent-GO", Component: AgentGoPane },
  { id: "models", label: "Models", Component: ModelsPane },
];

function ControlPaneInner() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const raw = params.get("tab");
  const active: TabId = (TABS.find((t) => t.id === raw)?.id ?? "runs");

  const setTab = useCallback(
    (id: TabId) => {
      const sp = new URLSearchParams(params.toString());
      if (id === "runs") {
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
      {/* Tab bar */}
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

      {/* Active tab content */}
      <div className="flex-1 overflow-hidden">
        <ActiveComponent />
      </div>
    </div>
  );
}

export function ControlPane() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-[var(--text-muted)]">Loading…</div>}>
      <ControlPaneInner />
    </Suspense>
  );
}
