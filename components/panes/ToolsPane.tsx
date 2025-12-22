"use client";

import { useState, useEffect } from "react";

interface ServiceStatus {
  name: string;
  url: string;
  status: "online" | "offline" | "unknown";
  latencyMs?: number;
  extra?: {
    vectors?: number;
    collections?: number;
    embedder?: string;
    model?: string;
    dimension?: number;
  };
}

interface GpuStats {
  name: string;
  memoryUsed: number;
  memoryTotal: number;
  memoryPercent: number;
  utilization: number;
  temperature: number;
}

export function ToolsPane() {
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [gpu, setGpu] = useState<GpuStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchStats = async () => {
    try {
      const res = await fetch("/api/system/stats");
      const data = await res.json();
      setServices(data.services ?? []);
      setGpu(data.gpu ?? null);
      setLastUpdate(new Date());
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 10000);
    return () => clearInterval(interval);
  }, []);

  const statusIcon = (status: ServiceStatus["status"]) => {
    switch (status) {
      case "online":
        return <span className="status-dot status-dot-online" />;
      case "offline":
        return <span className="status-dot status-dot-offline" />;
      default:
        return <span className="status-dot status-dot-pending" />;
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="pane-header">
        <span className="pane-title">Tools & Services</span>
        <div className="flex items-center gap-2">
          {lastUpdate && (
            <span className="text-xs text-[var(--text-muted)]">
              Updated {lastUpdate.toLocaleTimeString()}
            </span>
          )}
          <button onClick={fetchStats} className="btn btn-secondary text-xs">
            Refresh
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {loading ? (
          <div className="text-center text-[var(--text-muted)]">Loading...</div>
        ) : (
          <>
            {/* GPU Stats */}
            {gpu && (
              <div className="card">
                <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                  <span>🖥️</span> GPU
                </h3>
                <div className="space-y-3">
                  <div className="text-[var(--text-secondary)]">{gpu.name}</div>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <div className="text-xs text-[var(--text-muted)]">Memory</div>
                      <div className="text-lg font-mono">
                        {gpu.memoryUsed}MB / {gpu.memoryTotal}MB
                      </div>
                      <div className="mt-1 h-2 bg-[var(--bg-primary)] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[var(--accent)] transition-all"
                          style={{ width: `${gpu.memoryPercent}%` }}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-[var(--text-muted)]">Utilization</div>
                      <div className="text-lg font-mono">{gpu.utilization}%</div>
                      <div className="mt-1 h-2 bg-[var(--bg-primary)] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-green-500 transition-all"
                          style={{ width: `${gpu.utilization}%` }}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-[var(--text-muted)]">Temperature</div>
                      <div className="text-lg font-mono">{gpu.temperature}°C</div>
                      <div className="mt-1 h-2 bg-[var(--bg-primary)] rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all ${
                            gpu.temperature > 80
                              ? "bg-red-500"
                              : gpu.temperature > 60
                              ? "bg-yellow-500"
                              : "bg-green-500"
                          }`}
                          style={{ width: `${Math.min(gpu.temperature, 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Services */}
            <div className="card">
              <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                <span>🔧</span> Services
              </h3>
              <div className="space-y-2">
                {services.map((svc) => (
                  <div
                    key={svc.name}
                    className="py-2 px-3 bg-[var(--bg-primary)] rounded-lg"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {statusIcon(svc.status)}
                        <span>{svc.name}</span>
                      </div>
                      <div className="flex items-center gap-3 text-sm text-[var(--text-muted)]">
                        {svc.latencyMs !== undefined && (
                          <span>{svc.latencyMs}ms</span>
                        )}
                        <span
                          className={
                            svc.status === "online"
                              ? "text-green-400"
                              : svc.status === "offline"
                              ? "text-red-400"
                              : "text-yellow-400"
                          }
                        >
                          {svc.status}
                        </span>
                      </div>
                    </div>
                    {/* VectorDB extra stats */}
                    {svc.name === "VectorDB" && svc.extra && svc.status === "online" && (
                      <div className="mt-2 pt-2 border-t border-[var(--border)] grid grid-cols-4 gap-2 text-xs">
                        <div>
                          <div className="text-[var(--text-muted)]">Vectors</div>
                          <div className="font-mono">{svc.extra.vectors?.toLocaleString()}</div>
                        </div>
                        <div>
                          <div className="text-[var(--text-muted)]">Collections</div>
                          <div className="font-mono">{svc.extra.collections}</div>
                        </div>
                        <div>
                          <div className="text-[var(--text-muted)]">Embedder</div>
                          <div className="font-mono">{svc.extra.embedder}</div>
                        </div>
                        <div>
                          <div className="text-[var(--text-muted)]">Dimension</div>
                          <div className="font-mono">{svc.extra.dimension}d</div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Quick Actions */}
            <div className="card">
              <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                <span>⚡</span> Quick Actions
              </h3>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => window.open("http://localhost:8188", "_blank")}
                  className="btn btn-secondary justify-start"
                >
                  Open ComfyUI
                </button>
                <button
                  onClick={() => window.open("http://localhost:11434", "_blank")}
                  className="btn btn-secondary justify-start"
                >
                  Open Ollama API
                </button>
                <button
                  onClick={() => window.open("http://localhost:4242/dashboard/", "_blank")}
                  className="btn btn-secondary justify-start"
                >
                  Open VectorDB
                </button>
                <button
                  onClick={() => window.open("http://localhost:8888", "_blank")}
                  className="btn btn-secondary justify-start"
                >
                  Open SearxNG
                </button>
                <button
                  onClick={async () => {
                    await fetch("/api/agui/runs", { method: "DELETE" });
                    alert("Run history cleared");
                  }}
                  className="btn btn-secondary justify-start"
                >
                  Clear Run History
                </button>
                <button
                  onClick={() => window.location.reload()}
                  className="btn btn-secondary justify-start"
                >
                  Reload Dashboard
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
