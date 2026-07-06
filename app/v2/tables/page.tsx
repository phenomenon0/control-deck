"use client";
import "./tables-v2.css";
import { useEffect, useState } from "react";

const ChevDown = (
  <span className="ic"><svg viewBox="0 0 24 24" style={{ width: 11, height: 11 }}><path d="M6 9l6 6 6-6" /></svg></span>
);

type Row = {
  name: string;
  ref: string;
  backend: string;
  status: string;
  tone: "positive" | "caution" | "danger";
  params: string;
  updated: string;
  checked?: boolean;
};

/* Realistic placeholder fleet — initial render + graceful fallback when
   Ollama is unreachable. */
const ROWS_FALLBACK: Row[] = [
  { name: "qwen3-30b-a3b", ref: "ollama · llm", backend: "local", status: "serving", tone: "positive", params: "30.5B", updated: "2h ago", checked: true },
  { name: "sdxl-turbo", ref: "comfyui · image", backend: "local", status: "idle", tone: "caution", params: "3.5B", updated: "40m ago" },
  { name: "llama3.3-70b", ref: "openrouter · llm", backend: "cloud", status: "ready", tone: "positive", params: "70.0B", updated: "20m ago" },
  { name: "whisper-lg-v3", ref: "faster-whisper · asr", backend: "local", status: "serving", tone: "positive", params: "1.5B", updated: "jul 03" },
  { name: "hunyuan3d-2", ref: "comfyui · 3d", backend: "local", status: "blocked", tone: "danger", params: "2.1B", updated: "3d ago" },
];

interface TagModel {
  name: string;
  modified_at?: string;
  details?: { family?: string; parameter_size?: string };
}

/** Deterministic "N ago" formatter — pure code, no model in the loop. */
function rel(iso?: string): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "just now";
  const m = s / 60;
  if (m < 60) return `${Math.floor(m)}m ago`;
  const h = m / 60;
  if (h < 24) return `${Math.floor(h)}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function TablesV2Page() {
  const [rows, setRows] = useState<Row[]>(ROWS_FALLBACK);
  // Until the fleet fetch settles we show skeleton rows, not a flash of
  // placeholder data.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    // Real model fleet: /api/ollama/tags (installed) enriched with
    // /api/ollama/ps (loaded → serving). Keeps placeholders if Ollama is down.
    Promise.all([
      fetch("/api/ollama/tags").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/ollama/ps").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ])
      .then(([tags, ps]) => {
        const models: TagModel[] = Array.isArray(tags?.models) ? tags.models : [];
        if (!models.length || !alive) return; // keep fallback
        const loaded = new Set<string>((Array.isArray(ps?.models) ? ps.models : []).map((m: { name: string }) => m.name));
        setRows(
          models.map((m, i) => {
            const isLoaded = loaded.has(m.name);
            return {
              name: m.name,
              ref: `ollama · ${m.details?.family ?? "llm"}`,
              backend: "local",
              status: isLoaded ? "serving" : "idle",
              tone: (isLoaded ? "positive" : "caution") as Row["tone"],
              params: m.details?.parameter_size ?? "—",
              updated: rel(m.modified_at),
              checked: i === 0,
            };
          })
        );
      })
      .finally(() => { if (alive) setReady(true); });

    return () => { alive = false; };
  }, []);

  return (
    <div className="av2-tbl">
      <div className="wrap">
        <div className="top">
          <h1>Model fleet</h1>
          {ready ? (
            <span className="count">{rows.length} total · {rows.length} shown</span>
          ) : (
            <span className="count" aria-hidden>
              <span className="skel is-shimmer skel--line" style={{ width: 118, display: "inline-block", verticalAlign: "middle" }} />
            </span>
          )}
          <div className="spacer" />
          <div className="field" style={{ width: 230 }}>
            <input className="field__input" placeholder="search models…" aria-label="Search" />
          </div>
          <button className="btn">filter</button>
          <button className="btn btn--primary">deploy_model</button>
        </div>

        <div className="card tblcard">
          <table className="tbl tbl--fold">
            <thead>
              <tr>
                <th className="check">
                  <label className="ctl"><input type="checkbox" /><span className="ctl__box" /></label>
                </th>
                <th className="sort">model {ChevDown}</th>
                <th>backend</th>
                <th>status</th>
                <th className="num sort">params</th>
                <th className="num sort">updated {ChevDown}</th>
              </tr>
            </thead>
            <tbody>
              {ready
                ? rows.map((r) => (
                    <tr key={r.name}>
                      <td className="check">
                        <label className="ctl"><input type="checkbox" defaultChecked={r.checked} /><span className="ctl__box" /></label>
                      </td>
                      <td className="pname"><b>{r.name}</b><small>{r.ref}</small></td>
                      <td className="owner" data-th="backend">{r.backend}</td>
                      <td data-th="status"><span className={"tag tag--status tag--" + r.tone}>{r.status}</span></td>
                      <td className="num data" data-th="params">{r.params}</td>
                      <td className="num data" data-th="updated">{r.updated}</td>
                    </tr>
                  ))
                : [0, 1, 2, 3, 4].map((i) => (
                    <tr key={i} className="row--skel" aria-hidden>
                      <td className="check"><span className="skel is-shimmer skel--box" /></td>
                      <td className="pname">
                        <span className="skel is-shimmer skel--title" style={{ width: "58%" }} />
                        <span className="skel is-shimmer skel--line" style={{ width: "34%" }} />
                      </td>
                      <td className="owner" data-th="backend"><span className="skel is-shimmer skel--line" style={{ width: 40 }} /></td>
                      <td data-th="status"><span className="skel is-shimmer skel--tag" style={{ width: 64 }} /></td>
                      <td className="num" data-th="params"><span className="skel is-shimmer skel--line" style={{ width: 46 }} /></td>
                      <td className="num" data-th="updated"><span className="skel is-shimmer skel--line" style={{ width: 52 }} /></td>
                    </tr>
                  ))}
            </tbody>
          </table>
          <div className="tfoot">
            <span className="sel">1 selected · <span className="act">unload</span> · <span className="act">export</span></span>
            <div className="pages">
              <button className="btn btn--sm btn--icon" aria-label="Previous"><svg viewBox="0 0 24 24" style={{ width: 12, height: 12 }}><path d="M15 18l-6-6 6-6" /></svg></button>
              <span className="pg">1 / 3</span>
              <button className="btn btn--sm btn--icon" aria-label="Next"><svg viewBox="0 0 24 24" style={{ width: 12, height: 12 }}><path d="M9 18l6-6-6-6" /></svg></button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
