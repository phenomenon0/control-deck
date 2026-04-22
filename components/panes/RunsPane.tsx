"use client";

/**
 * RunsPane — thin coordinator for /deck/control?tab=runs.
 *
 * All data lives in `useRunsData`; every view is a small component under
 * `components/panes/runs/*`. This file's job is to switch views and thread
 * state into each one.
 *
 * Before decomposition this file was 930 lines; the split lets each
 * concern (list rows, glyph inspector, tool-call detail, telemetry,
 * approvals) evolve without fighting the others for scope in one module.
 */

import { useState } from "react";
import { useRunsData } from "@/components/panes/runs/useRunsData";
import { RunsHeader } from "@/components/panes/runs/RunsHeader";
import { RunsList } from "@/components/panes/runs/RunsList";
import { RunDetailPanel } from "@/components/panes/runs/RunDetailPanel";
import { KpiStrip } from "@/components/panes/runs/KpiStrip";
import { SurfaceStrip } from "@/components/panes/runs/SurfaceStrip";
import { GlyphView } from "@/components/panes/runs/GlyphView";
import { MetricsDashboard } from "@/components/panes/runs/MetricsDashboard";
import { ApprovalsQueue } from "@/components/panes/runs/ApprovalsQueue";
import type { ViewMode } from "@/components/panes/runs/types";

export function RunsPane() {
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const data = useRunsData(viewMode);

  const handleClear = async () => {
    if (!confirm("Clear all run history?")) return;
    await data.clearAll();
  };

  if (viewMode === "metrics") {
    return (
      <div className="runs-stage runs-stage--real">
        <RunsHeader viewMode="metrics" setViewMode={setViewMode} />
        <MetricsDashboard />
      </div>
    );
  }

  if (viewMode === "approvals") {
    return (
      <div className="runs-stage runs-stage--real">
        <RunsHeader viewMode="approvals" setViewMode={setViewMode} />
        <ApprovalsQueue />
      </div>
    );
  }

  if (viewMode === "glyph") {
    return (
      <GlyphView
        viewMode={viewMode}
        setViewMode={setViewMode}
        payloads={data.allGlyphPayloads}
        onRefresh={data.fetchAllGlyphPayloads}
      />
    );
  }

  const runningCount = data.runs.filter((r) => r.status === "running").length;

  return (
    <div className="runs-stage runs-stage--real">
      <RunsHeader viewMode="list" setViewMode={setViewMode} onClear={handleClear} />
      <SurfaceStrip runningCount={runningCount} />
      <KpiStrip runs={data.runs} todayCost={data.todayCost} />

      <div className={`runs-real-layout ${data.selectedRun ? "has-detail" : ""}`}>
        <RunsList
          runs={data.runs}
          loading={data.loading}
          selectedRun={data.selectedRun}
          onSelect={data.setSelectedRun}
        />
        {data.selectedRun && (
          <RunDetailPanel
            runId={data.selectedRun}
            runEvents={data.runEvents}
            toolCallList={data.toolCallList}
            loadingEvents={data.loadingEvents}
            onClose={() => data.setSelectedRun(null)}
          />
        )}
      </div>
    </div>
  );
}
