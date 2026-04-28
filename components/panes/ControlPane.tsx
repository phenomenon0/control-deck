"use client";

/**
 * ControlPane — 5th surface, a tabbed dashboard unifying Runs, Tools,
 * UI Studio (née DoJo), and AgentGo. The default tab is Runs,
 * which acts as a blended overview of activity across the other tabs.
 *
 * Tabs are URL-persisted via `?tab=`.
 */

import { Suspense, type ComponentType } from "react";
import { RunsPane } from "@/components/panes/RunsPane";
import { ToolsPane } from "@/components/panes/ToolsPane";
import { DojoPane } from "@/components/dojo";
import { AgentGoPane } from "@/components/panes/AgentGoPane";
import { useUrlTab } from "@/lib/hooks/useUrlTab";

type TabId = "runs" | "tools" | "studio" | "agentgo";

interface TabDef {
  id: TabId;
  label: string;
  Component: ComponentType;
}

// Models moved to its own first-class surface at /deck/models (see
// InferenceControlPane). The Ollama-specific ModelsPane is now reachable
// from inside the Models pane's provider inspector.
const TABS: readonly TabDef[] = [
  { id: "runs", label: "Runs", Component: RunsPane },
  { id: "tools", label: "Tools", Component: ToolsPane },
  { id: "studio", label: "UI Studio", Component: DojoPane },
  { id: "agentgo", label: "Agent-GO", Component: AgentGoPane },
];

function ControlPaneInner() {
  const { active, setTab } = useUrlTab(TABS, "runs");
  const ActiveComponent = TABS.find((t) => t.id === active)!.Component;

  return (
    <div className="h-full flex flex-col">
      {/* Tab bar */}
      <div className="control-tabbar" role="tablist" aria-label="Control sections">
        {TABS.map((tab) => {
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              id={`control-tab-${tab.id}`}
              role="tab"
              aria-controls={`control-panel-${tab.id}`}
              aria-selected={isActive}
              onClick={() => setTab(tab.id)}
              className={`control-tab${isActive ? " control-tab--active" : ""}`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Active tab content */}
      <div
        id={`control-panel-${active}`}
        role="tabpanel"
        aria-labelledby={`control-tab-${active}`}
        className="flex-1 overflow-hidden"
      >
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
