"use client";

/**
 * LocalModelPanel — the Local tab of RoutePicker.
 *
 * Replaces the old dead-end "Pull one from Hardware" hint with a two-view
 * model manager:
 *   - installed: the existing tag list, with inline pull progress overlay
 *     if a row is being re-pulled / updated.
 *   - discover:  CatalogMiniGrid — VRAM-fit-ranked candidates from
 *                /api/inference/suggestions with inline Pull buttons.
 *
 * Auto-flips to discover when no tags are installed but Ollama is up
 * (so users always land on something actionable). Exposes a "Switch view"
 * toggle so either view is reachable manually.
 */

import { AlertTriangle, Cpu, Compass, X } from "lucide-react";
import { useMemo } from "react";

import { useModelPull } from "@/lib/hooks/useModelPull";
import { CatalogMiniGrid } from "@/components/chat/CatalogMiniGrid";

interface OllamaTag {
  name: string;
  size: number;
  details?: {
    parameter_size?: string;
    quantization_level?: string;
    family?: string;
  };
}

interface LoadedModel {
  name: string;
  size_vram: number;
}

interface LoadWarning {
  target: string;
  blockers: { name: string; size_vram?: number }[];
}

interface Props {
  tags: OllamaTag[];
  loaded: LoadedModel[];
  reachable: boolean;
  busy: string | null;
  activeName: string;
  view: "installed" | "discover";
  onViewChange: (v: "installed" | "discover") => void;
  onPick: (name: string) => void;
  onRefresh: () => void | Promise<void>;
  loadWarning?: LoadWarning | null;
  onUnloadBlocker?: (name: string) => void;
  onDismissWarning?: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function LocalModelPanel({
  tags,
  loaded,
  reachable,
  busy,
  activeName,
  view,
  onViewChange,
  onPick,
  onRefresh,
  loadWarning,
  onUnloadBlocker,
  onDismissWarning,
}: Props) {
  const loadedNames = useMemo(() => new Set(loaded.map((m) => m.name)), [loaded]);
  const { progressFor, abort } = useModelPull();

  const showDiscover = view === "discover" || (reachable && tags.length === 0);

  return (
    <div className="composer-local-panel">
      <div className="composer-model-head">
        <span className="composer-tweaks-axis-label">
          {showDiscover ? "Discover models" : "Installed models"}
        </span>
        <div className="composer-local-toggle" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={view === "installed"}
            className={`composer-local-toggle-btn${view === "installed" ? " is-active" : ""}`}
            onClick={() => onViewChange("installed")}
            title="Installed models"
            disabled={!reachable}
          >
            <Cpu size={11} /> Installed
            {tags.length > 0 && <span className="composer-local-toggle-count">{tags.length}</span>}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "discover"}
            className={`composer-local-toggle-btn${view === "discover" ? " is-active" : ""}`}
            onClick={() => onViewChange("discover")}
            title="Discover new models to pull"
          >
            <Compass size={11} /> Discover
          </button>
        </div>
      </div>

      {!reachable && (
        <p className="composer-model-hint">
          Ollama daemon not reachable — run <code>ollama serve</code>.
        </p>
      )}

      {loadWarning && (
        <div className="composer-vram-warning">
          <div className="composer-vram-warning-head">
            <AlertTriangle size={12} />
            <span>
              <strong>{loadWarning.target}</strong> didn&apos;t land in VRAM — may be blocked by:
            </span>
            <button
              type="button"
              className="composer-vram-warning-dismiss"
              onClick={onDismissWarning}
              aria-label="Dismiss"
            >
              <X size={10} />
            </button>
          </div>
          <ul className="composer-vram-warning-list">
            {loadWarning.blockers.map((b) => (
              <li key={b.name}>
                <span className="composer-vram-warning-name">{b.name}</span>
                {typeof b.size_vram === "number" && b.size_vram > 0 && (
                  <span className="composer-vram-warning-size">
                    {formatBytes(b.size_vram)}
                  </span>
                )}
                {onUnloadBlocker && (
                  <button
                    type="button"
                    className="composer-mini-btn"
                    onClick={() => onUnloadBlocker(b.name)}
                  >
                    Unload &amp; retry
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {reachable && !showDiscover && (
        <ul className="composer-model-list">
          {tags.map((m) => {
            const isActive = m.name === activeName;
            const isLoaded = loadedNames.has(m.name);
            const isBusy = busy === m.name;
            const prog = progressFor(m.name);
            const pulling = prog?.phase === "pulling" || prog?.phase === "queued";
            return (
              <li key={m.name}>
                <button
                  type="button"
                  className={`composer-model-row${isActive ? " is-active" : ""}`}
                  onClick={() => onPick(m.name)}
                  disabled={isBusy || pulling}
                >
                  <div className="composer-model-row-main">
                    <span className="composer-model-row-name">{m.name}</span>
                    {isLoaded && <span className="composer-model-hot">HOT</span>}
                    {isActive && <span className="composer-model-active-dot" />}
                  </div>
                  <div className="composer-model-row-meta">
                    {m.details?.parameter_size ?? "?"} ·{" "}
                    {m.details?.quantization_level ?? ""} · {formatBytes(m.size)}
                    {isBusy && <span> · loading…</span>}
                  </div>
                  {pulling && prog && (
                    <div className="composer-mini-progress composer-mini-progress--row">
                      <div className="composer-mini-bar">
                        <div
                          className="composer-mini-bar-fill"
                          style={{ width: `${Math.round(prog.overallPct)}%` }}
                        />
                      </div>
                      <div className="composer-mini-progress-meta">
                        <span className="composer-mini-status">{prog.statusLine}</span>
                        <span className="composer-mini-speed">
                          {Math.round(prog.overallPct)}%
                        </span>
                        <span
                          role="button"
                          tabIndex={0}
                          className="composer-mini-abort"
                          onClick={(e) => {
                            e.stopPropagation();
                            abort(m.name);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              e.stopPropagation();
                              abort(m.name);
                            }
                          }}
                          aria-label="Cancel pull"
                        >
                          <X size={10} />
                        </span>
                      </div>
                    </div>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {reachable && showDiscover && (
        <CatalogMiniGrid
          modality="text"
          limit={10}
          activeTag={activeName}
          onPick={onPick}
          onPulled={() => {
            void onRefresh();
          }}
        />
      )}
    </div>
  );
}
