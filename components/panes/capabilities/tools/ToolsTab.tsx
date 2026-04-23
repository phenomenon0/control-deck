"use client";

/**
 * Tools tab — read-only inspector for the Zod-defined tool catalogue.
 *
 * Fetches `/api/tools` which returns each ToolDefinition joined with
 * invocation stats. Detail pane shows the signature, description, and
 * recent-usage numbers. No editor — tool schemas are code-authored in
 * `lib/tools/definitions.ts`.
 */

import { useEffect, useMemo, useState } from "react";
import { InspectorShell, GroupByControl, type InspectorItem } from "../shared/InspectorShell";
import { modalityForTool, MODALITY_LABEL, MODALITY_ORDER } from "@/lib/tools/modality";

interface ToolParam {
  name: string;
  type: string;
  required: boolean;
  description: string;
  default?: unknown;
}

interface ToolEntry {
  name: string;
  description: string;
  parameters: ToolParam[];
  stats: {
    count: number;
    errors: number;
    lastInvokedAt: string | null;
    avgDurationMs: number | null;
  };
}

type ToolGrouping = "none" | "modality" | "usage";

export function ToolsTab() {
  const [tools, setTools] = useState<ToolEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [grouping, setGrouping] = useState<ToolGrouping>("modality");
  const [compact, setCompact] = useState(true);

  useEffect(() => {
    fetch("/api/tools", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { tools: ToolEntry[] }) => {
        setTools(d.tools ?? []);
        setSelectedId((prev) => prev ?? d.tools?.[0]?.name ?? null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const items: Array<InspectorItem & ToolEntry & { modality: string }> = useMemo(
    () =>
      tools.map((t) => ({
        ...t,
        id: t.name,
        modality: modalityForTool(t.name),
        badges: [
          { label: MODALITY_LABEL[modalityForTool(t.name)], tone: "accent" as const },
          t.stats.count > 0
            ? { label: `${t.stats.count} calls`, tone: "default" as const }
            : { label: "unused", tone: "default" as const },
          ...(t.stats.errors > 0
            ? [{ label: `${t.stats.errors} errors`, tone: "warn" as const }]
            : []),
        ],
      })),
    [tools],
  );

  const groupByFn = useMemo(() => {
    if (grouping === "modality")
      return (it: (typeof items)[number]) => it.modality;
    if (grouping === "usage")
      return (it: (typeof items)[number]) =>
        it.stats.count === 0 ? "unused" : it.stats.count < 5 ? "occasional" : "frequent";
    return undefined;
  }, [grouping]);

  const groupOrder = useMemo(() => {
    if (grouping === "modality") {
      return MODALITY_ORDER.map((m) => ({ key: m, label: MODALITY_LABEL[m] }));
    }
    if (grouping === "usage") {
      return [
        { key: "frequent", label: "Frequent (5+ calls)" },
        { key: "occasional", label: "Occasional (1–4)" },
        { key: "unused", label: "Unused" },
      ];
    }
    return undefined;
  }, [grouping]);

  if (loading) {
    return <div className="capabilities-empty">Loading tools…</div>;
  }

  return (
    <InspectorShell<InspectorItem & ToolEntry & { modality: string }>
      items={items}
      selectedId={selectedId}
      onSelect={setSelectedId}
      emptyHint="No tools registered."
      searchPlaceholder="Search tools…"
      groupBy={groupByFn}
      groupOrder={groupOrder}
      density={compact ? "compact" : "comfortable"}
      preHeader={
        <div className="capabilities-preheader">
          <GroupByControl<ToolGrouping>
            value={grouping}
            onChange={setGrouping}
            options={[
              { value: "modality", label: "Modality" },
              { value: "usage", label: "Usage" },
              { value: "none", label: "Flat" },
            ]}
          />
          <button
            type="button"
            className={`capabilities-density-btn${compact ? " on" : ""}`}
            onClick={() => setCompact((c) => !c)}
            title={compact ? "Switch to comfortable rows" : "Switch to compact rows"}
          >
            {compact ? "Compact" : "Cozy"}
          </button>
        </div>
      }
      renderDetail={(tool) => {
        if (!tool) {
          return (
            <div className="capabilities-detail-empty">
              Select a tool to inspect its schema and usage.
            </div>
          );
        }
        return (
          <div className="capabilities-detail-body">
            <header className="capabilities-detail-head">
              <h2>{tool.name}</h2>
              <p>{tool.description}</p>
            </header>

            <section className="capabilities-panel">
              <h3>Signature</h3>
              <table className="capabilities-table">
                <thead>
                  <tr>
                    <th>Parameter</th>
                    <th>Type</th>
                    <th>Required</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {tool.parameters.map((p) => (
                    <tr key={p.name}>
                      <td><code>{p.name}</code></td>
                      <td>{p.type}</td>
                      <td>{p.required ? "yes" : "no"}</td>
                      <td>{p.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="capabilities-panel">
              <h3>Usage</h3>
              <div className="capabilities-stats">
                <Stat label="Calls" value={tool.stats.count.toString()} />
                <Stat label="Errors" value={tool.stats.errors.toString()} />
                <Stat
                  label="Avg duration"
                  value={tool.stats.avgDurationMs
                    ? `${Math.round(tool.stats.avgDurationMs)}ms`
                    : "—"}
                />
                <Stat
                  label="Last invoked"
                  value={tool.stats.lastInvokedAt ?? "—"}
                />
              </div>
            </section>
          </div>
        );
      }}
    />
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="capabilities-stat">
      <div className="capabilities-stat-label">{label}</div>
      <div className="capabilities-stat-value">{value}</div>
    </div>
  );
}
