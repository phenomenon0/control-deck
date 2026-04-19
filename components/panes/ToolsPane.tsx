"use client";

import { useSystemStats, type ServiceStatus } from "@/lib/hooks/useSystemStats";

export function ToolsPane() {
  const { stats, refresh } = useSystemStats();
  const services = stats?.services ?? [];
  const gpu = stats?.gpu ?? null;
  const loading = !stats;

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
    <div className="tools-stage">
      <header className="tools-head">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="label">Runtime</div>
            <h1>Tools & Services</h1>
            <p>GPU telemetry, service status, and launch actions for the local tool stack.</p>
          </div>
          <div className="warp-pane-actions">
            <span className="pill--mono">{services.length} services</span>
            <button onClick={refresh} className="btn btn-secondary text-xs">
              Refresh
            </button>
          </div>
        </div>
      </header>

      <div className="space-y-6">
        {loading ? (
          <div className="text-center text-[var(--text-muted)] py-12">Loading...</div>
        ) : (
          <>
            {/* GPU Stats */}
            {gpu && (
              <div>
                <h3 className="section-title mb-3">GPU</h3>
                <div className="rounded-[6px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] p-4">
                  <div className="text-sm font-medium text-[var(--text-primary)] mb-3">{gpu.name}</div>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <div className="text-xs text-[var(--text-muted)] mb-1">Memory</div>
                      <div className="text-base font-mono text-[var(--text-primary)]">
                        {gpu.memoryUsed}<span className="text-[var(--text-muted)]">/{gpu.memoryTotal}MB</span>
                      </div>
                      <div className="mt-2 h-1 w-full rounded-full bg-[rgba(255,255,255,0.06)] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[var(--accent)] transition-all duration-150"
                          style={{ width: `${gpu.memoryPercent}%` }}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-[var(--text-muted)] mb-1">Utilization</div>
                      <div className="text-base font-mono text-[var(--text-primary)]">{gpu.utilization}%</div>
                      <div className="mt-2 h-1 w-full rounded-full bg-[rgba(255,255,255,0.06)] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[var(--accent)] transition-all duration-150"
                          style={{
                            width: `${gpu.utilization}%`,
                            background: gpu.utilization > 80 ? "linear-gradient(90deg, var(--warning), #FFCC00)" : undefined,
                          }}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-[var(--text-muted)] mb-1">Temperature</div>
                      <div className="text-base font-mono text-[var(--text-primary)]">{gpu.temperature}°C</div>
                      <div className="mt-2 h-1 w-full rounded-full bg-[rgba(255,255,255,0.06)] overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-150"
                          style={{
                            width: `${Math.min(gpu.temperature, 100)}%`,
                            background: gpu.temperature > 80
                              ? "linear-gradient(90deg, var(--error), #FF6961)"
                              : gpu.temperature > 60
                              ? "linear-gradient(90deg, var(--warning), #FFCC00)"
                              : "linear-gradient(90deg, var(--success), #4CD964)",
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Services */}
            <div>
              <h3 className="section-title mb-3">Services</h3>
              <div className="space-y-2">
                {services.map((svc) => (
                  <div
                    key={svc.name}
                    className="rounded-[6px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.04)] transition-colors duration-150 ease-[cubic-bezier(0,0,0.2,1)] p-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className={`inline-block w-[6px] h-[6px] rounded-full flex-shrink-0 ${
                          svc.status === "online" ? "bg-[var(--success)]"
                          : svc.status === "offline" ? "bg-[var(--error)]"
                          : "bg-[var(--warning)]"
                        }`} />
                        <span className="text-sm font-medium text-[var(--text-primary)]">{svc.name}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
                        {svc.latencyMs !== undefined && (
                          <span className="font-mono">{svc.latencyMs}ms</span>
                        )}
                        <span className={`font-medium ${
                          svc.status === "online" ? "text-[var(--success)]"
                          : svc.status === "offline" ? "text-[var(--error)]"
                          : "text-[var(--warning)]"
                        }`}>
                          {svc.status}
                        </span>
                      </div>
                    </div>
                    {/* VectorDB extra stats */}
                    {svc.name === "VectorDB" && svc.extra && svc.status === "online" && (
                      <div className="mt-3 pt-3 border-t border-[var(--border)] grid grid-cols-4 gap-2 text-xs">
                        <div>
                          <div className="text-[var(--text-muted)]">Vectors</div>
                          <div className="font-mono text-[var(--text-primary)]">{svc.extra.vectors?.toLocaleString()}</div>
                        </div>
                        <div>
                          <div className="text-[var(--text-muted)]">Collections</div>
                          <div className="font-mono text-[var(--text-primary)]">{svc.extra.collections}</div>
                        </div>
                        <div>
                          <div className="text-[var(--text-muted)]">Embedder</div>
                          <div className="font-mono text-[var(--text-primary)]">{svc.extra.embedder}</div>
                        </div>
                        <div>
                          <div className="text-[var(--text-muted)]">Dimension</div>
                          <div className="font-mono text-[var(--text-primary)]">{svc.extra.dimension}d</div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Quick Actions */}
            <div>
              <h3 className="section-title mb-3">Quick Actions</h3>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    const svc = services.find(s => s.name === "ComfyUI");
                    window.open(svc?.url || "http://localhost:8188", "_blank");
                  }}
                  className="rounded-[6px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.04)] transition-colors duration-150 ease-[cubic-bezier(0,0,0.2,1)] px-3 py-2.5 text-sm text-[var(--text-secondary)] text-left flex items-center justify-start gap-2"
                >
                  Open ComfyUI
                </button>
                <button
                  onClick={() => {
                    const svc = services.find(s => s.name === "Ollama");
                    window.open(svc?.url?.replace("/api/tags", "") || "http://localhost:11434", "_blank");
                  }}
                  className="rounded-[6px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.04)] transition-colors duration-150 ease-[cubic-bezier(0,0,0.2,1)] px-3 py-2.5 text-sm text-[var(--text-secondary)] text-left flex items-center justify-start gap-2"
                >
                  Open Ollama API
                </button>
                <button
                  onClick={() => {
                    const svc = services.find(s => s.name === "VectorDB");
                    window.open((svc?.url || "http://localhost:4242") + "/dashboard/", "_blank");
                  }}
                  className="rounded-[6px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.04)] transition-colors duration-150 ease-[cubic-bezier(0,0,0.2,1)] px-3 py-2.5 text-sm text-[var(--text-secondary)] text-left flex items-center justify-start gap-2"
                >
                  Open VectorDB
                </button>
                <button
                  onClick={() => {
                    const svc = services.find(s => s.name === "SearxNG");
                    window.open(svc?.url?.replace("/healthz", "") || "http://localhost:8888", "_blank");
                  }}
                  className="rounded-[6px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.04)] transition-colors duration-150 ease-[cubic-bezier(0,0,0.2,1)] px-3 py-2.5 text-sm text-[var(--text-secondary)] text-left flex items-center justify-start gap-2"
                >
                  Open SearxNG
                </button>
                <button
                  onClick={async () => {
                    await fetch("/api/agui/runs", { method: "DELETE" });
                    alert("Run history cleared");
                  }}
                  className="rounded-[6px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.04)] transition-colors duration-150 ease-[cubic-bezier(0,0,0.2,1)] px-3 py-2.5 text-sm text-[var(--text-secondary)] text-left flex items-center justify-start gap-2"
                >
                  Clear Run History
                </button>
                <button
                  onClick={() => window.location.reload()}
                  className="rounded-[6px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.04)] transition-colors duration-150 ease-[cubic-bezier(0,0,0.2,1)] px-3 py-2.5 text-sm text-[var(--text-secondary)] text-left flex items-center justify-start gap-2"
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
