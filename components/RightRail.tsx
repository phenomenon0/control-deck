"use client";

import { useState, useEffect } from "react";
import { useDeckSettings, THEME_META, type ThemeName } from "@/components/settings/DeckSettingsProvider";
import type { ToolCallData } from "@/components/chat/ToolCallCard";
import type { Artifact } from "@/components/chat/ArtifactRenderer";
import { ToolResultCard } from "@/components/sidebar/ToolResultCard";

// =============================================================================
// Types
// =============================================================================

interface SystemStats {
  gpu: {
    name: string;
    memoryUsed: number;
    memoryTotal: number;
    memoryPercent: number;
    utilization: number;
    temperature: number;
  } | null;
  services: Array<{
    name: string;
    url: string;
    status: "online" | "offline" | "unknown";
    latencyMs?: number;
  }>;
}

interface RightRailProps {
  threadId: string | null;
  model: string;
  isLoading: boolean;
  toolCalls: ToolCallData[];
  artifacts: Artifact[];
  onSendMessage?: (text: string) => void;
}

// =============================================================================
// RightRail Component - Unified Sidebar
// =============================================================================

export function RightRail({ 
  threadId, 
  model, 
  isLoading, 
  toolCalls, 
  artifacts,
  onSendMessage 
}: RightRailProps) {
  const { railOpen, setRailOpen, prefs, updatePrefs } = useDeckSettings();
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [expandedArtifact, setExpandedArtifact] = useState<Artifact | null>(null);
  const [filesExpanded, setFilesExpanded] = useState(false);

  // Fetch system stats
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch("/api/system/stats");
        if (res.ok) setSystemStats(await res.json());
      } catch {}
    };
    fetchStats();
    const interval = setInterval(fetchStats, 10000);
    return () => clearInterval(interval);
  }, []);

  // Fetch models
  useEffect(() => {
    fetch("/api/ollama/tags")
      .then((r) => r.json())
      .then((data) => {
        if (data.models) setModels(data.models.map((m: { name: string }) => m.name));
      })
      .catch(() => {});
  }, []);

  const onlineServices = systemStats?.services.filter(s => s.status === "online").length ?? 0;
  const totalServices = systemStats?.services.length ?? 0;

  if (!railOpen) {
    // Collapsed mini bar
    return (
      <aside className="right-rail collapsed">
        <button className="rail-expand-btn" onClick={() => setRailOpen(true)} title="Expand sidebar">
          <ChevronLeftIcon size={16} />
        </button>
        
        {/* Mini status indicators */}
        <div className="rail-mini-status">
          {isLoading && <div className="mini-dot loading" title="Running..." />}
          {systemStats?.gpu && (
            <div 
              className="mini-gpu" 
              title={`GPU: ${systemStats.gpu.memoryPercent}% • ${systemStats.gpu.temperature}°C`}
            >
              {systemStats.gpu.memoryPercent}%
            </div>
          )}
          <div className="mini-services" title={`${onlineServices}/${totalServices} services`}>
            <span className={onlineServices === totalServices ? "online" : "partial"}>●</span>
          </div>
          {artifacts.length > 0 && (
            <div className="mini-artifacts" title={`${artifacts.length} files`}>
              {artifacts.length}
            </div>
          )}
        </div>
      </aside>
    );
  }

  return (
    <aside className="right-rail expanded">
      {/* Header */}
      <div className="sidebar-header">
        <span className="sidebar-title">Control Panel</span>
        <button className="rail-close" onClick={() => setRailOpen(false)} title="Collapse">
          <ChevronRightIcon size={14} />
        </button>
      </div>

      <div className="sidebar-content">
        {/* ===== STATUS + MODEL ===== */}
        <section className="sidebar-section">
          <div className="section-row">
            <div className="status-chip">
              <span className={`status-dot ${isLoading ? "running" : "idle"}`} />
              <span>{isLoading ? "Running" : "Idle"}</span>
            </div>
            <select
              className="model-select"
              value={prefs.model}
              onChange={(e) => updatePrefs({ model: e.target.value })}
              title="Select model"
            >
              {models.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </section>

        {/* ===== GPU ===== */}
        {systemStats?.gpu && (
          <section className="sidebar-section">
            <div className="gpu-compact">
              <div className="gpu-header">
                <span className="gpu-label">GPU</span>
                <span className="gpu-temp">{systemStats.gpu.temperature}°C</span>
              </div>
              <div className="gpu-bar-compact">
                <div 
                  className="gpu-bar-fill" 
                  style={{ width: `${systemStats.gpu.memoryPercent}%` }} 
                />
              </div>
              <div className="gpu-stats">
                <span>{systemStats.gpu.memoryUsed}MB / {systemStats.gpu.memoryTotal}MB</span>
                <span>{systemStats.gpu.utilization}% util</span>
              </div>
            </div>
          </section>
        )}

        {/* ===== TOOL CALLS (inspectable) ===== */}
        <section className="sidebar-section">
          <h4 className="section-title">
            Tool Calls
            {toolCalls.length > 0 && <span className="count-badge">{toolCalls.length}</span>}
          </h4>
          {toolCalls.length > 0 ? (
            <div className="tool-calls-list">
              {toolCalls.slice(-6).reverse().map((tc) => (
                tc.status === "complete" && tc.result ? (
                  <ToolResultCard key={tc.id} tool={tc} />
                ) : (
                  <ToolCallRow key={tc.id} tool={tc} />
                )
              ))}
              {toolCalls.length > 6 && (
                <div className="more-indicator">+{toolCalls.length - 6} more in Runs →</div>
              )}
            </div>
          ) : (
            <div className="empty-hint">No tool calls yet</div>
          )}
        </section>

        {/* ===== FILES/ARTIFACTS (collapsible) ===== */}
        <section className="sidebar-section">
          <button 
            className="section-title-btn"
            onClick={() => setFilesExpanded(!filesExpanded)}
          >
            <span className={`section-chevron ${filesExpanded ? "open" : ""}`}>›</span>
            <span>Files</span>
            {artifacts.length > 0 && <span className="count-badge">{artifacts.length}</span>}
          </button>
          {filesExpanded && (
            artifacts.length > 0 ? (
              <div className="artifacts-grid">
                {artifacts.slice(-6).map((a, idx) => (
                  <ArtifactThumb 
                    key={`${a.id}-${idx}`} 
                    artifact={a} 
                    onClick={() => setExpandedArtifact(a)}
                  />
                ))}
              </div>
            ) : (
              <div className="empty-hint">Generated files appear here</div>
            )
          )}
        </section>

        {/* ===== QUICK TOOLS ===== */}
        <section className="sidebar-section">
          <h4 className="section-title">Quick</h4>
          <div className="quick-tools">
            <QuickTool icon="🎨" label="Image" onClick={() => onSendMessage?.("Generate an image of ")} />
            <QuickTool icon="🎵" label="Audio" onClick={() => onSendMessage?.("Generate audio: ")} />
            <QuickTool icon="🔍" label="Search" onClick={() => onSendMessage?.("Search for ")} />
            <QuickTool icon="💻" label="Code" onClick={() => onSendMessage?.("Write code that ")} />
          </div>
        </section>

        {/* ===== THEME ===== */}
        <section className="sidebar-section">
          <h4 className="section-title">Theme</h4>
          <div className="theme-pills">
            {(Object.keys(THEME_META) as ThemeName[]).map((t) => (
              <button
                key={t}
                className={`theme-pill ${prefs.theme === t ? "active" : ""}`}
                onClick={() => updatePrefs({ theme: t })}
                title={THEME_META[t].description}
              >
                {THEME_META[t].label.split(" ")[0]}
              </button>
            ))}
          </div>
        </section>

        {/* ===== LINKS + SERVICES (bottom) ===== */}
        <section className="sidebar-section sidebar-bottom">
          <div className="bottom-row">
            <div className="external-links">
              <a href="http://localhost:8188" target="_blank" rel="noopener noreferrer" title="ComfyUI">🎨</a>
              <a href="http://localhost:8888" target="_blank" rel="noopener noreferrer" title="SearxNG">🔍</a>
              <a href="http://localhost:4242/health" target="_blank" rel="noopener noreferrer" title="VectorDB">📚</a>
              <a href="http://localhost:11434" target="_blank" rel="noopener noreferrer" title="Ollama">🧠</a>
            </div>
            <div className="services-compact">
              {systemStats?.services.map((svc) => (
                <span 
                  key={svc.name} 
                  className={`service-dot-only ${svc.status === "online" ? "online" : "offline"}`}
                  title={`${svc.name}: ${svc.status}`}
                />
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* Footer with thread info */}
      <div className="sidebar-footer">
        {threadId ? (
          <span className="thread-id" title={threadId}>
            Thread: {threadId.slice(0, 8)}...
          </span>
        ) : (
          <span className="thread-id">No active thread</span>
        )}
      </div>

      {/* Artifact Modal */}
      {expandedArtifact && (
        <ArtifactModal 
          artifact={expandedArtifact} 
          onClose={() => setExpandedArtifact(null)} 
        />
      )}
    </aside>
  );
}

// =============================================================================
// Sub-components
// =============================================================================

function ServicePill({ service }: { service: { name: string; status: string; latencyMs?: number } }) {
  const isOnline = service.status === "online";
  const shortName = service.name.replace("API", "").replace("UI", "").trim();
  
  return (
    <div className={`service-pill ${isOnline ? "online" : "offline"}`} title={`${service.name}: ${service.status}${service.latencyMs ? ` (${service.latencyMs}ms)` : ""}`}>
      <span className="service-dot" />
      <span>{shortName}</span>
    </div>
  );
}

function ToolCallRow({ tool }: { tool: ToolCallData }) {
  const [expanded, setExpanded] = useState(false);
  const statusColor = tool.status === "complete" ? "success" : tool.status === "error" ? "error" : "running";
  const duration = tool.durationMs ? (tool.durationMs > 1000 ? `${(tool.durationMs / 1000).toFixed(1)}s` : `${tool.durationMs}ms`) : null;
  
  // Get the main argument (prompt, query, code, etc.)
  const mainArg = tool.args ? getMainArg(tool.args) : null;
  const resultMessage = getResultMessage(tool.result);
  const hasDetails = mainArg || resultMessage || (tool.args && Object.keys(tool.args).length > 0);
  
  return (
    <div className={`tool-call-row ${statusColor} ${expanded ? "expanded" : ""}`}>
      <button 
        className="tool-call-header"
        onClick={() => hasDetails && setExpanded(!expanded)}
        style={{ cursor: hasDetails ? "pointer" : "default" }}
      >
        <span className="tool-status-dot" />
        <span className="tool-name">{tool.name.replace(/_/g, " ")}</span>
        {duration && <span className="tool-duration">{duration}</span>}
        {tool.status === "running" && <span className="tool-running">...</span>}
        {hasDetails && (
          <span className={`tool-chevron ${expanded ? "open" : ""}`}>›</span>
        )}
      </button>
      
      {expanded && hasDetails && (
        <div className="tool-call-details">
          {mainArg && (
            <div className="tool-detail-row">
              <span className="tool-detail-label">Input</span>
              <span className="tool-detail-value">{truncate(mainArg, 150)}</span>
            </div>
          )}
          {resultMessage && (
            <div className="tool-detail-row">
              <span className="tool-detail-label">Result</span>
              <span className={`tool-detail-value ${tool.result?.success === false ? "error" : ""}`}>
                {truncate(resultMessage, 200)}
              </span>
            </div>
          )}
          {tool.args && Object.keys(tool.args).filter(k => !["prompt", "query", "code", "text", "instruction"].includes(k)).length > 0 && (
            <div className="tool-detail-row">
              <span className="tool-detail-label">Params</span>
              <span className="tool-detail-value mono">
                {Object.entries(tool.args)
                  .filter(([k]) => !["prompt", "query", "code", "text", "instruction"].includes(k))
                  .map(([k, v]) => `${k}=${formatArg(v)}`)
                  .join(", ")}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function getMainArg(args: Record<string, unknown>): string | null {
  const keys = ["prompt", "query", "code", "text", "instruction", "question"];
  for (const key of keys) {
    if (args[key] && typeof args[key] === "string") {
      return args[key] as string;
    }
  }
  return null;
}

function getResultMessage(result: ToolCallData["result"]): string | null {
  if (!result) return null;
  
  // Check for explicit message or error
  if (result.error) return result.error;
  if (result.message) return result.message;
  
  // Check for output in data (code execution results)
  if (result.data) {
    const data = result.data as Record<string, unknown>;
    if (data.output && typeof data.output === "string") return data.output;
    if (data.stdout && typeof data.stdout === "string") return data.stdout;
    if (data.result && typeof data.result === "string") return data.result;
    // For searches
    if (data.results && Array.isArray(data.results)) {
      return `Found ${data.results.length} results`;
    }
  }
  
  // Fallback
  if (result.success === false) return "Failed";
  if (result.success === true) return "Success";
  
  return null;
}

function formatArg(value: unknown): string {
  if (typeof value === "string") return value.length > 20 ? value.slice(0, 20) + "..." : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.length}]`;
  return "{...}";
}

function truncate(str: string, max: number): string {
  return str.length <= max ? str : str.slice(0, max) + "...";
}

function ArtifactThumb({ artifact, onClick }: { artifact: Artifact; onClick: () => void }) {
  const isImage = artifact.mimeType?.startsWith("image/");
  const isAudio = artifact.mimeType?.startsWith("audio/");
  
  return (
    <button className="artifact-thumb" onClick={onClick} title={artifact.name}>
      {isImage ? (
        <img src={artifact.url} alt={artifact.name} />
      ) : isAudio ? (
        <span className="artifact-icon">🎵</span>
      ) : (
        <span className="artifact-icon">📄</span>
      )}
    </button>
  );
}

function ArtifactModal({ artifact, onClose }: { artifact: Artifact; onClose: () => void }) {
  const isImage = artifact.mimeType?.startsWith("image/");
  const isAudio = artifact.mimeType?.startsWith("audio/");
  
  return (
    <div className="artifact-modal-overlay" onClick={onClose}>
      <div className="artifact-modal" onClick={(e) => e.stopPropagation()}>
        <div className="artifact-modal-header">
          <span>{artifact.name}</span>
          <button onClick={onClose}>×</button>
        </div>
        <div className="artifact-modal-content">
          {isImage && <img src={artifact.url} alt={artifact.name} />}
          {isAudio && <audio src={artifact.url} controls />}
          {!isImage && !isAudio && (
            <div className="artifact-download">
              <a href={artifact.url} download={artifact.name}>Download {artifact.name}</a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function QuickTool({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button className="quick-tool" onClick={onClick} title={label}>
      <span>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

// =============================================================================
// Icons
// =============================================================================

function ChevronLeftIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function ChevronRightIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
