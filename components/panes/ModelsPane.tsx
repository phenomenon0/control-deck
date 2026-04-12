"use client";

import { useState, useEffect } from "react";

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
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [pulling, setPulling] = useState<string | null>(null);
  const [newModel, setNewModel] = useState("");

  const fetchModels = async () => {
    try {
      const res = await fetch("/api/ollama/tags");
      const data = await res.json();
      setModels(data.models ?? []);
    } catch (err) {
      console.warn("[ModelsPane] fetch failed:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchModels();
  }, []);

  const handlePull = async () => {
    if (!newModel.trim()) return;
    setPulling(newModel);
    try {
      await fetch("/api/ollama/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newModel }),
      });
      await fetchModels();
      setNewModel("");
    } catch (e) {
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
      await fetchModels();
    } catch {
      alert("Failed to delete model");
    }
  };

  const formatSize = (bytes: number) => {
    const gb = bytes / 1024 / 1024 / 1024;
    if (gb >= 1) return `${gb.toFixed(1)} GB`;
    const mb = bytes / 1024 / 1024;
    return `${mb.toFixed(0)} MB`;
  };

  const formatDate = (iso: string) => {
    return new Date(iso).toLocaleDateString();
  };

  return (
    <div className="h-full flex flex-col bg-[var(--bg-primary)]">
      {/* Frosted Header */}
      <div className="sticky top-0 z-10 bg-[var(--bg-secondary)] flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
        <span className="text-sm font-semibold tracking-tight">Models ({models.length})</span>
        <button onClick={fetchModels} className="btn btn-secondary text-xs">
          Refresh
        </button>
      </div>

      {/* Pull new model — pill input */}
      <div className="p-4 border-b border-[var(--border)]">
        <div className="flex gap-2">
          <input
            type="text"
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            placeholder="Pull a model (e.g. llama3.2:3b)"
            className="flex-1 h-9 px-3 rounded-[6px] bg-[rgba(255,255,255,0.04)] border border-[var(--border)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)] transition-colors duration-150 ease-[cubic-bezier(0,0,0.2,1)]"
            onKeyDown={(e) => e.key === "Enter" && handlePull()}
          />
          <button
            onClick={handlePull}
            disabled={!!pulling || !newModel.trim()}
            className="btn btn-primary"
          >
            {pulling ? "Pulling..." : "Pull"}
          </button>
        </div>
        {pulling && (
          <div className="mt-3">
            <div className="h-1 w-full rounded-full bg-[rgba(255,255,255,0.06)] overflow-hidden">
              <div className="h-full rounded-full bg-[var(--accent)] animate-pulse" style={{ width: "60%" }} />
            </div>
            <p className="text-xs text-[var(--text-muted)] mt-1">Pulling {pulling}...</p>
          </div>
        )}
      </div>

      {/* Models grid */}
      <div className="flex-1 overflow-y-auto p-4">
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
            {models.map((model, idx) => (
              <div
                key={model.name}
                className="rounded-[6px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.04)] transition-colors duration-150 ease-[cubic-bezier(0,0,0.2,1)] p-4"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-[var(--text-primary)] truncate">{model.name}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="badge badge-info text-[10px]">{model.details?.family ?? "unknown"}</span>
                      <span className="text-xs text-[var(--text-muted)]">{model.details?.parameter_size ?? "?"}</span>
                    </div>
                  </div>
                  <span className="inline-block w-[6px] h-[6px] rounded-full bg-[var(--success)] ml-2 mt-1 flex-shrink-0" title="Available" />
                </div>

                <div className="flex items-center gap-3 text-xs text-[var(--text-muted)] mb-3">
                  <span className="font-mono">{formatSize(model.size)}</span>
                  {model.details?.quantization_level && (
                    <span className="badge badge-neutral text-[10px]">{model.details.quantization_level}</span>
                  )}
                </div>

                <div className="flex items-center gap-2 pt-3 border-t border-[var(--border)]">
                  <button
                    onClick={() => navigator.clipboard.writeText(model.name)}
                    className="btn btn-ghost text-xs flex-1"
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
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
