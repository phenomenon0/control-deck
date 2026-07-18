"use client";

/**
 * Models pane — local model library management (Ollama). Pull/delete
 * models, estimate VRAM, and set the default chat model. Each card's
 * "Set as default" writes `prefs.model`, which ChatSurface threads into
 * /api/chat and the RoutePicker pill reflects immediately.
 *
 * The Free-tier and Cloud tabs were removed: their routing prefs
 * (routeMode / remoteModel / cloudProvider / cloudModel) never reached
 * the send path, so the tabs rendered picks that did nothing.
 */

import { useState, useEffect, useCallback } from "react";
import { Gauge, Check } from "lucide-react";
import { VramEstimator } from "@/components/models/VramEstimator";
import { LocalModelsPanel } from "@/components/models/LocalModelsPanel";
import { useDeckSettings } from "@/components/settings/DeckSettingsProvider";

interface OllamaModel {
  name: string;
  model: string;
  modified_at: string;
  size: number;
  digest: string;
  details: {
    parent_model: string;
    format: string;
    family: string;
    families: string[];
    parameter_size: string;
    quantization_level: string;
  };
}

export function ModelsPane() {
  const { prefs, updatePrefs } = useDeckSettings();

  const [models, setModels] = useState<OllamaModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [pulling, setPulling] = useState<string | null>(null);
  const [newModel, setNewModel] = useState("");
  const [vramTarget, setVramTarget] = useState<OllamaModel | null>(null);

  const fetchOllama = useCallback(async () => {
    try {
      const res = await fetch("/api/ollama/tags");
      const data = await res.json();
      setModels(data.models ?? []);
    } catch (err) {
      console.warn("[ModelsPane] Ollama fetch failed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOllama();
  }, [fetchOllama]);

  // --- Actions ---
  const handlePull = async () => {
    if (!newModel.trim()) return;
    setPulling(newModel);
    try {
      await fetch("/api/ollama/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newModel }),
      });
      await fetchOllama();
      setNewModel("");
    } catch {
      alert("Failed to pull model");
    } finally {
      setPulling(null);
    }
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`Delete model "${name}"?`)) return;
    try {
      await fetch("/api/ollama/tags", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      await fetchOllama();
    } catch {
      alert("Failed to delete model");
    }
  };

  /** Make this the default model for chat. */
  const setDefault = (modelId: string) => {
    updatePrefs({ model: modelId });
  };

  const isCurrentDefault = (modelId: string) => prefs.model === modelId;

  const formatSize = (bytes: number) => {
    const gb = bytes / 1024 / 1024 / 1024;
    if (gb >= 1) return `${gb.toFixed(1)} GB`;
    const mb = bytes / 1024 / 1024;
    return `${mb.toFixed(0)} MB`;
  };

  return (
    <div className="models-stage">
      <header className="models-head">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="label">Model catalog</div>
            <h1>Models</h1>
            <p>
              Local model library. Click &quot;Set as default&quot; on any card to make it the
              active model for chat.
            </p>
          </div>
          <div className="warp-pane-actions">
            <span className="pill--mono">
              active: {prefs.model || "—"}
            </span>
          </div>
        </div>
      </header>

      <LocalModelsPanel
        preset={prefs.localModelPreset}
        onPresetChange={(p) => updatePrefs({ localModelPreset: p })}
      />

      <div className="warp-pane-card p-4 mb-6">
        <div className="flex gap-2">
          <input
            type="text"
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            placeholder="Pull a model (e.g. llama3.2:3b)"
            className="flex-1 h-9 px-3 rounded-[6px] bg-[rgba(255,255,255,0.04)] border border-[var(--border)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)] transition-colors duration-150 ease-[cubic-bezier(0,0,0.2,1)]"
            onKeyDown={(e) => e.key === "Enter" && handlePull()}
          />
          <button onClick={handlePull} disabled={!!pulling || !newModel.trim()} className="btn btn-primary">
            {pulling ? "Pulling..." : "Pull"}
          </button>
          <button onClick={fetchOllama} className="btn btn-secondary text-xs">
            Refresh
          </button>
        </div>
        {pulling && (
          <div className="mt-3">
            <div className="h-1 w-full rounded-full bg-[rgba(255,255,255,0.06)] overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--accent)] animate-pulse"
                style={{ width: "60%" }}
              />
            </div>
            <p className="text-xs text-[var(--text-muted)] mt-1">Pulling {pulling}...</p>
          </div>
        )}
      </div>

      <div>
        {loading ? (
          <div className="p-12 text-center text-[var(--text-muted)]">Loading...</div>
        ) : models.length === 0 ? (
          <div className="p-16 text-center">
            <div className="text-5xl mb-4 opacity-30">&#9881;</div>
            <p className="text-base font-medium text-[var(--text-secondary)] mb-2">No models installed</p>
            <p className="text-sm text-[var(--text-muted)] mb-6">Pull a model to get started</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {models.map((model) => {
              const isDefault = isCurrentDefault(model.name);
              return (
                <div
                  key={model.name}
                  className={`rounded-[6px] border ${isDefault ? "border-[var(--accent)]" : "border-[var(--border)]"} bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.04)] transition-colors p-4`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-[var(--text-primary)] truncate flex items-center gap-2">
                        {model.name}
                        {isDefault && <Check size={12} className="text-[var(--accent)]" />}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="badge badge-info text-[10px]">{model.details?.family ?? "unknown"}</span>
                        <span className="text-xs text-[var(--text-muted)]">{model.details?.parameter_size ?? "?"}</span>
                      </div>
                    </div>
                    <span
                      className="inline-block w-[6px] h-[6px] rounded-full bg-[var(--success)] ml-2 mt-1 flex-shrink-0"
                      title="Available"
                    />
                  </div>

                  <div className="flex items-center gap-3 text-xs text-[var(--text-muted)] mb-3">
                    <span className="font-mono">{formatSize(model.size)}</span>
                    {model.details?.quantization_level && (
                      <span className="badge badge-neutral text-[10px]">{model.details.quantization_level}</span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-[var(--border)]">
                    <button
                      onClick={() => setDefault(model.name)}
                      className={`btn text-xs ${isDefault ? "btn-ghost opacity-60 cursor-default" : "btn-primary"}`}
                      disabled={isDefault}
                    >
                      {isDefault ? "Default" : "Set default"}
                    </button>
                    <button onClick={() => setVramTarget(model)} className="btn btn-ghost text-xs" title="Estimate VRAM">
                      <Gauge className="w-3.5 h-3.5 mr-1 inline" />
                      VRAM
                    </button>
                    <button
                      onClick={() => navigator.clipboard.writeText(model.name)}
                      className="btn btn-ghost text-xs"
                      title="Copy name"
                    >
                      Copy
                    </button>
                    <button
                      onClick={() => handleDelete(model.name)}
                      className="btn btn-ghost text-xs text-[var(--error)]"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {vramTarget && (
        <VramEstimator
          modelName={vramTarget.name}
          modelBytes={vramTarget.size}
          onClose={() => setVramTarget(null)}
        />
      )}
    </div>
  );
}
