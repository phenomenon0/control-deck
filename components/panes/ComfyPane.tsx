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
    } catch (err) {
      console.warn("[ComfyPane] fetch failed:", err);
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
    <div className="comfy-stage">
      <header className="comfy-head">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="label">Image pipeline</div>
            <h1>ComfyUI</h1>
            <p>Preset workflows, queue control, and recent generated assets from the local ComfyUI service.</p>
          </div>
          <div className="warp-pane-actions">
            <span className="pill--status pill--status-finished">Connected</span>
            <button onClick={handleInterrupt} className="btn btn-secondary text-xs">
              Interrupt
            </button>
            <button
              onClick={() => window.open("http://localhost:8188", "_blank")}
              className="btn btn-primary text-xs"
            >
              Open UI
            </button>
            <button onClick={fetchHistory} className="btn btn-secondary text-xs">
              Refresh
            </button>
          </div>
        </div>
      </header>

      <div className="space-y-6">
        {/* Preset Workflows */}
        <div>
          <h3 className="section-title mb-3">Preset Workflows</h3>
          <div className="grid grid-cols-3 gap-3">
            {PRESET_WORKFLOWS.map((wf) => (
              <button
                key={wf.id}
                disabled
                title="Preset workflows not yet implemented"
                className="rounded-[6px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] p-4 text-left opacity-50 cursor-not-allowed"
              >
                <div className="text-sm font-semibold text-[var(--text-primary)]">{wf.name}</div>
                <div className="text-xs text-[var(--text-muted)] mt-1">{wf.description}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Recent Jobs */}
        <div>
          <h3 className="section-title mb-3">Recent Jobs</h3>
          {loading ? (
            <div className="text-center text-[var(--text-muted)] py-8">Loading...</div>
          ) : jobs.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-5xl mb-4 opacity-30">&#9881;</div>
              <p className="text-base font-medium text-[var(--text-secondary)] mb-2">No jobs in history</p>
              <p className="text-sm text-[var(--text-muted)]">Queue a workflow to see results here</p>
            </div>
          ) : (
            <div className="space-y-3">
              {jobs.slice(0, 10).map((job, idx) => {
                const images = getOutputImages(job);
                return (
                  <div
                    key={job.promptId}
                    className="rounded-[6px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.04)] transition-colors duration-150 ease-[cubic-bezier(0,0,0.2,1)] p-3"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`inline-block w-[6px] h-[6px] rounded-full flex-shrink-0 ${job.status?.completed ? "bg-[var(--success)]" : "bg-[var(--accent)]"}`} />
                        <span className="font-mono text-xs text-[var(--text-secondary)]">{job.promptId.slice(0, 8)}</span>
                      </div>
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
                            className="h-20 w-20 object-cover rounded-[6px] border border-[var(--border)]"
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
