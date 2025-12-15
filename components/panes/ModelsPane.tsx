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
    } catch {
      // ignore
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
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="pane-header">
        <span className="pane-title">Models ({models.length})</span>
        <button onClick={fetchModels} className="btn btn-secondary text-xs">
          Refresh
        </button>
      </div>

      {/* Pull new model */}
      <div className="p-4 border-b border-[var(--border)]">
        <div className="flex gap-2">
          <input
            type="text"
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            placeholder="Pull a model (e.g. llama3.2:3b)"
            className="input flex-1"
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
      </div>

      {/* Models list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-[var(--text-muted)]">Loading...</div>
        ) : models.length === 0 ? (
          <div className="p-8 text-center text-[var(--text-muted)]">
            <div className="text-4xl mb-4">🧠</div>
            <p>No models installed</p>
            <p className="text-sm mt-2">Pull a model to get started</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {models.map((model) => (
              <div
                key={model.name}
                className="p-4 hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-medium">{model.name}</div>
                    <div className="flex items-center gap-3 mt-1 text-sm text-[var(--text-muted)]">
                      <span>{model.details?.family ?? "unknown"}</span>
                      <span>{model.details?.parameter_size ?? "?"}</span>
                      <span>{model.details?.quantization_level ?? ""}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-[var(--text-muted)]">
                      <span>{formatSize(model.size)}</span>
                      <span>Modified {formatDate(model.modified_at)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(model.name);
                      }}
                      className="btn btn-ghost text-xs"
                      title="Copy name"
                    >
                      Copy
                    </button>
                    <button
                      onClick={() => handleDelete(model.name)}
                      className="btn btn-ghost text-xs text-red-400 hover:text-red-300"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
