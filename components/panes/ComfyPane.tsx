"use client";

import { useState, useEffect } from "react";

interface ComfyJob {
  promptId: string;
  status?: { status_str: string; completed: boolean };
  outputs?: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }>;
}

const PRESET_WORKFLOWS = [
  { id: "stable-audio", name: "Stable Audio", description: "Generate audio from text" },
  { id: "hunyuan-3d", name: "Hunyuan 3D", description: "Image to 3D model" },
  { id: "qwen-edit", name: "Qwen Edit", description: "AI image editing" },
];

export function ComfyPane() {
  const [jobs, setJobs] = useState<ComfyJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [queueing, setQueueing] = useState(false);

  const fetchHistory = async () => {
    try {
      const res = await fetch("/api/comfy/history?limit=20");
      const data = await res.json();
      setJobs(data.items ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
    const interval = setInterval(fetchHistory, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleInterrupt = async () => {
    await fetch("/api/comfy/history", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
  };

  const getOutputImages = (job: ComfyJob) => {
    if (!job.outputs) return [];
    const images: Array<{ filename: string; subfolder: string; type: string }> = [];
    for (const node of Object.values(job.outputs)) {
      if (node.images) {
        images.push(...node.images);
      }
    }
    return images;
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="pane-header">
        <span className="pane-title">ComfyUI</span>
        <div className="flex items-center gap-2">
          <button onClick={handleInterrupt} className="btn btn-secondary text-xs">
            Interrupt
          </button>
          <button
            onClick={() => window.open("http://localhost:8188", "_blank")}
            className="btn btn-secondary text-xs"
          >
            Open UI
          </button>
          <button onClick={fetchHistory} className="btn btn-secondary text-xs">
            Refresh
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Preset Workflows */}
        <div className="card">
          <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
            <span>🎨</span> Preset Workflows
          </h3>
          <div className="grid grid-cols-3 gap-3">
            {PRESET_WORKFLOWS.map((wf) => (
              <button
                key={wf.id}
                disabled={queueing}
                className="p-4 text-left bg-[var(--bg-primary)] rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors border border-[var(--border)]"
                onClick={() => alert(`TODO: Load ${wf.id} workflow`)}
              >
                <div className="font-medium">{wf.name}</div>
                <div className="text-xs text-[var(--text-muted)] mt-1">{wf.description}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Recent Jobs */}
        <div className="card">
          <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
            <span>📋</span> Recent Jobs
          </h3>
          {loading ? (
            <div className="text-center text-[var(--text-muted)] py-4">Loading...</div>
          ) : jobs.length === 0 ? (
            <div className="text-center text-[var(--text-muted)] py-4">
              No jobs in history
            </div>
          ) : (
            <div className="space-y-3">
              {jobs.slice(0, 10).map((job) => {
                const images = getOutputImages(job);
                return (
                  <div
                    key={job.promptId}
                    className="p-3 bg-[var(--bg-primary)] rounded-lg"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono text-xs">{job.promptId.slice(0, 8)}</span>
                      <span
                        className={`badge ${
                          job.status?.completed
                            ? "badge-success"
                            : "badge-warning"
                        }`}
                      >
                        {job.status?.completed ? "Done" : job.status?.status_str ?? "Pending"}
                      </span>
                    </div>
                    {images.length > 0 && (
                      <div className="flex gap-2 overflow-x-auto">
                        {images.map((img, i) => (
                          <img
                            key={i}
                            src={`/api/comfy/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${img.type}`}
                            alt={img.filename}
                            className="h-20 w-20 object-cover rounded"
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
