"use client";

/* =============================================================================
   ATLAS VISUAL 2 — TOOLS. The agent's tool catalog (mirrors the deck's
   Capabilities view). Master list grouped by modality + a right detail pane
   showing the selected tool's signature (params table + policy).

   REAL DATA: reads the live tool registry —
     TOOL_DEFINITIONS  (@/lib/tools/definitions)   name/description/params
     modalityForTool + labels (@/lib/tools/modality)
     getManifest       (@/lib/tools/manifest)       risk/sideEffect/policy
   These modules are pure (zod only, no server-only), so a client component
   can consume them directly and drive search + selection.
   ============================================================================= */

import { useMemo, useState } from "react";
import { TOOL_DEFINITIONS } from "@/lib/tools/definitions";
import {
  modalityForTool,
  MODALITY_LABEL,
  MODALITY_ORDER,
  type ToolModality,
} from "@/lib/tools/modality";
import { getManifest, type RiskLevel } from "@/lib/tools/manifest";
import "./tools-v2.css";

type Tone = "positive" | "caution" | "danger";

const RISK_TONE: Record<RiskLevel, Tone> = {
  read_only: "positive",
  low_write: "caution",
  medium_write: "caution",
  high_write: "danger",
  sensitive: "danger",
  dangerous: "danger",
};

interface ToolView {
  name: string;
  description: string;
  modality: ToolModality;
  kind: string;
  risk: RiskLevel;
  tone: Tone;
  sideEffect: string;
  allowInMcp: boolean;
  requiresApproval: boolean;
  timeoutMs: number;
  params: { name: string; type: string; required: boolean; description: string; default?: unknown }[];
}

// Build the view model once from the real registry.
const TOOLS: ToolView[] = TOOL_DEFINITIONS.map((def) => {
  const modality = modalityForTool(def.name);
  const m = getManifest(def.name);
  return {
    name: def.name,
    description: def.description,
    modality,
    kind: MODALITY_LABEL[modality],
    risk: m.risk,
    tone: RISK_TONE[m.risk],
    sideEffect: m.sideEffect,
    allowInMcp: m.allowInMcp,
    requiresApproval: m.requiresApproval,
    timeoutMs: m.timeoutMs,
    params: def.parameters,
  };
});

const GROUPS = MODALITY_ORDER
  .map((mod) => ({ mod, label: MODALITY_LABEL[mod], tools: TOOLS.filter((t) => t.modality === mod) }))
  .filter((g) => g.tools.length > 0);

const MODALITY_COUNT = GROUPS.length;

export default function ToolsV2Page() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string>(TOOLS[0]?.name ?? "");

  const q = query.trim().toLowerCase();
  const groups = useMemo(() => {
    if (!q) return GROUPS;
    return GROUPS
      .map((g) => ({
        ...g,
        tools: g.tools.filter(
          (t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.tools.length > 0);
  }, [q]);

  const shown = groups.reduce((n, g) => n + g.tools.length, 0);
  const active = TOOLS.find((t) => t.name === selected) ?? TOOLS[0];

  return (
    <div className="av2-tools">
      <header className="top">
        <h1>Tools</h1>
        <span className="count">
          {TOOLS.length} tools · {MODALITY_COUNT} modalities
        </span>
        <div className="spacer" />
        <div className="field" style={{ width: 240 }}>
          <input
            className="field__input"
            placeholder="search tools…"
            aria-label="Search tools"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </header>

      <div className="body">
        {/* ── master list ─────────────────────────────────────────────── */}
        <div className="list" role="listbox" aria-label="Tool catalog">
          {groups.length === 0 && <div className="noresult">no tools match “{query}”</div>}
          {groups.map((g) => (
            <section className="grp" key={g.mod}>
              <div className="grp__head">
                {g.label}
                <span className="grp__n">{g.tools.length}</span>
              </div>
              {g.tools.map((t) => (
                <button
                  key={t.name}
                  type="button"
                  className={"trow" + (t.name === selected ? " is-active" : "")}
                  onClick={() => setSelected(t.name)}
                  role="option"
                  aria-selected={t.name === selected}
                >
                  <span className="trow__main">
                    <b className="trow__name">{t.name}</b>
                    <small className="trow__desc">{t.description}</small>
                  </span>
                  <span className="trow__meta">
                    <span className="tag">{t.kind}</span>
                    <span className={"tag tag--status tag--" + t.tone}>{t.risk.replace("_", " ")}</span>
                  </span>
                </button>
              ))}
            </section>
          ))}
        </div>

        {/* ── detail: signature ───────────────────────────────────────── */}
        {active && (
          <aside className="detail">
            <div className="card panel">
              <span className="kicker">{active.kind}</span>
              <h2 className="sig">
                {active.name}
                <span className="sig__paren">(</span>
                {active.params.map((p, i) => (
                  <span key={p.name} className="sig__arg">
                    {p.name}
                    {!p.required && <span className="sig__opt">?</span>}
                    {i < active.params.length - 1 && <span className="sig__comma">, </span>}
                  </span>
                ))}
                <span className="sig__paren">)</span>
              </h2>
              <p className="desc">{active.description}</p>

              <div className="policy">
                <span className={"tag tag--status tag--" + active.tone}>{active.risk.replace("_", " ")}</span>
                <span className="tag">{active.sideEffect}</span>
                <span className={"tag" + (active.allowInMcp ? " tag--accent" : "")}>
                  mcp: {active.allowInMcp ? "yes" : "no"}
                </span>
                {active.requiresApproval && <span className="tag tag--status tag--caution">approval</span>}
                <span className="tag">{(active.timeoutMs / 1000).toFixed(0)}s timeout</span>
              </div>

              <div className="sec-label">
                Parameters<span className="sec-label__n">{active.params.length}</span>
              </div>
              {active.params.length === 0 ? (
                <div className="card card--well noparams">no parameters</div>
              ) : (
                <table className="ptbl">
                  <thead>
                    <tr>
                      <th>param</th>
                      <th>type</th>
                      <th className="req">req</th>
                      <th>notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {active.params.map((p) => (
                      <tr key={p.name}>
                        <td className="pn">{p.name}</td>
                        <td className="pt">{p.type}</td>
                        <td className="req">
                          {p.required ? (
                            <span className="dot dot--req" title="required" />
                          ) : (
                            <span className="dot" title="optional" />
                          )}
                        </td>
                        <td className="pd">
                          {p.description}
                          {p.default !== undefined && (
                            <span className="pdef">default {JSON.stringify(p.default)}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
