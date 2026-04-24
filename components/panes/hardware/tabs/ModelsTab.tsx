"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { GpuStats } from "@/lib/hooks/useSystemStats";
import type { LoadedOllamaModel } from "@/app/api/ollama/ps/route";
import { canFit, estimateVramMb, fitLabel, type FitResult } from "@/lib/hardware/vram";
import { useModelPull, type PullProgress } from "@/lib/hooks/useModelPull";
import { bytes, relativeTime } from "../types";

export interface InstalledModel {
  name: string;
  model: string;
  size: number;
  details: { parameter_size: string; quantization_level: string; family: string };
}

/**
 * Models tab — unified view of what's in VRAM right now + everything
 * installed on disk (Ollama today; multi-provider when we extend listInstalled
 * merging). Inline fit badges tell you whether each will actually run.
 *
 * Pull operations route through the shared useModelPull store so progress
 * surfaces identically in the RoutePicker Local tab and elsewhere.
 * `onPull` remains as a refresh signal that fires once per completed pull.
 */
export function ModelsTab({
  gpu,
  loaded,
  installed,
  onUnload,
  onPullComplete,
  onDelete,
}: {
  gpu: GpuStats | null;
  loaded: LoadedOllamaModel[];
  installed: InstalledModel[];
  onUnload: (name: string) => void;
  /** Fires once per completed pull so the parent can refresh installed list. */
  onPullComplete: (name: string) => void | Promise<void>;
  onDelete: (name: string) => void;
}) {
  const [pullName, setPullName] = useState("");
  const { pull, abort, progress } = useModelPull();
  const seenDoneRef = useRef<Set<string>>(new Set());

  const submitPull = () => {
    const tag = pullName.trim();
    if (!tag) return;
    pull(tag);
    setPullName("");
  };

  // Fire `onPullComplete` once per completed pull so the parent refreshes
  // the installed list. Tracked per-tag so the singleton store retaining a
  // finished entry doesn't retrigger on every render.
  useEffect(() => {
    progress.forEach((p, tag) => {
      if (p.phase === "done" && !seenDoneRef.current.has(tag)) {
        seenDoneRef.current.add(tag);
        void onPullComplete(tag);
      }
    });
  }, [progress, onPullComplete]);

  const activePulls = Array.from(progress.values()).filter(
    (p) => p.phase === "queued" || p.phase === "pulling",
  );

  return (
    <>
      {/* Loaded */}
      <section className="hardware-panel">
        <header>
          <h2>Active in VRAM</h2>
          <span className="hardware-panel-meta">
            {loaded.length === 0
              ? "nothing loaded"
              : `${loaded.length} model${loaded.length === 1 ? "" : "s"}`}
          </span>
        </header>
        {loaded.length === 0 ? (
          <div className="hardware-empty">
            Nothing resident right now. Send any provider a request and it'll show up here.
          </div>
        ) : (
          <ul className="hardware-loaded-list">
            {loaded.map((m) => (
              <li key={m.digest}>
                <div className="hardware-loaded-main">
                  <div className="hardware-loaded-name">{m.name}</div>
                  <div className="hardware-loaded-meta">
                    {m.details.parameter_size} · {m.details.quantization_level} · {bytes(m.size_vram)} VRAM · expires {relativeTime(m.expires_at)}
                  </div>
                </div>
                <button
                  type="button"
                  className="hardware-btn hardware-btn--danger"
                  onClick={() => onUnload(m.name)}
                >
                  Unload
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Installed */}
      <section className="hardware-panel">
        <header>
          <h2>Installed</h2>
          <span className="hardware-panel-meta">
            {installed.length} on disk · {bytes(installed.reduce((s, m) => s + m.size, 0))}
          </span>
        </header>
        <div className="hardware-pull">
          <input
            type="text"
            className="hardware-pull-input"
            placeholder="ollama pull … (e.g. llama3.2:3b)"
            value={pullName}
            onChange={(e) => setPullName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitPull()}
          />
          <button
            type="button"
            className="hardware-btn hardware-btn--primary"
            onClick={submitPull}
            disabled={!pullName.trim()}
          >
            Pull
          </button>
        </div>
        {activePulls.length > 0 && (
          <ul className="hardware-pull-list">
            {activePulls.map((p) => (
              <li key={p.tag}>
                <PullLine progress={p} onAbort={() => abort(p.tag)} />
              </li>
            ))}
          </ul>
        )}
        <ul className="hardware-installed-list">
          {installed.map((m) => {
            const isLoaded = loaded.some((p) => p.name === m.name);
            const fit = canFit(estimateVramMb(m.size), gpu);
            return (
              <li key={m.name}>
                <div className="hardware-installed-main">
                  <div className="hardware-installed-name">
                    {m.name}
                    {isLoaded && <span className="hardware-badge hardware-badge--hot">HOT</span>}
                    <FitBadge fit={fit} />
                  </div>
                  <div className="hardware-installed-meta">
                    {m.details.parameter_size} · {m.details.quantization_level} · {bytes(m.size)} · {m.details.family}
                  </div>
                </div>
                <button
                  type="button"
                  className="hardware-btn hardware-btn--ghost"
                  onClick={() => onDelete(m.name)}
                >
                  Delete
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}

function PullLine({
  progress,
  onAbort,
}: {
  progress: PullProgress;
  onAbort: () => void;
}) {
  const pct = Math.round(progress.overallPct);
  return (
    <div className="hardware-pull-row">
      <div className="hardware-pull-row-head">
        <span className="hardware-pull-row-name">{progress.tag}</span>
        <span className="hardware-pull-row-status">{progress.statusLine}</span>
        <button
          type="button"
          className="hardware-pull-row-abort"
          onClick={onAbort}
          aria-label="Cancel pull"
        >
          <X size={12} />
        </button>
      </div>
      <div className="hardware-pull-row-bar">
        <div
          className="hardware-pull-row-bar-fill"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="hardware-pull-row-meta">
        {pct}%{progress.bytesPerSec > 0 && ` · ${formatRate(progress.bytesPerSec)}`}
      </div>
    </div>
  );
}

function formatRate(bps: number): string {
  if (bps >= 1024 * 1024) return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
  if (bps >= 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${Math.round(bps)} B/s`;
}

function FitBadge({ fit }: { fit: FitResult }) {
  const tone =
    fit.verdict === "ok"
      ? "hardware-fit--ok"
      : fit.verdict === "warn"
        ? "hardware-fit--warn"
        : fit.verdict === "block"
          ? "hardware-fit--block"
          : "hardware-fit--unknown";
  const tooltip = fit.freeMb !== null
    ? `${fit.reason} (needs ~${fit.estimateMb} MB · free ${fit.freeMb} MB)`
    : fit.reason;
  return (
    <span className={`hardware-badge hardware-fit ${tone}`} title={tooltip}>
      {fitLabel(fit.verdict)}
    </span>
  );
}
