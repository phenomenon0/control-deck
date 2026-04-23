"use client";

import { useState, useEffect } from "react";
import { X, Cpu, Wrench, FileText } from "lucide-react";
import { useChatInspectorData } from "@/lib/hooks/useChatInspector";
import { useSystemStats } from "@/lib/hooks/useSystemStats";
import { useModels } from "@/lib/hooks/useModels";
import { useDeckSettings } from "@/components/settings/DeckSettingsProvider";
import { ToolResultCard } from "@/components/sidebar/ToolResultCard";
import type { ToolCallData } from "@/components/chat/ToolCallCard";
import type { Artifact } from "@/components/chat/ArtifactRenderer";

interface InspectorSheetProps {
  open: boolean;
  onClose: () => void;
}

function formatModelName(model: string): string {
  if (model.includes("/") || model.includes("\\")) {
    const parts = model.split(/[/\\]/);
    const filename = parts[parts.length - 1];
    return filename.replace(/\.gguf$/i, "");
  }
  return model;
}

export function InspectorSheet({ open, onClose }: InspectorSheetProps) {
  const { threadId, model, isLoading, toolCalls, artifacts } = useChatInspectorData();
  const { stats: systemStats } = useSystemStats();
  const { models } = useModels();
  const { prefs, updatePrefs } = useDeckSettings();
  const [expandedArtifact, setExpandedArtifact] = useState<Artifact | null>(null);

  // Track mount state for animation
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      // Trigger enter animation on next frame
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
    } else {
      setVisible(false);
      // Exit is 100ms — unmount after that
      const timer = setTimeout(() => setMounted(false), 120);
      return () => clearTimeout(timer);
    }
  }, [open]);

  const onlineServices = systemStats?.services.filter((s) => s.status === "online").length ?? 0;
  const totalServices = systemStats?.services.length ?? 0;

  if (!mounted) return null;

  return (
    <>
      {/* Scrim backdrop */}
      <div
        className={`inspector-scrim${visible ? " visible" : ""}`}
        onClick={onClose}
      />

      {/* Sheet */}
      <aside className={`inspector-sheet${visible ? " visible" : ""}`}>
        {/* Header */}
        <div className="inspector-header">
          <h2 className="inspector-title">Inspector</h2>
          <button onClick={onClose} className="inspector-close" title="Close (Esc)">
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="inspector-content">
          {/* Status + Model */}
          <div className="inspector-status-row">
            <span className={`status-dot ${isLoading ? "running" : "idle"}`} />
            <select
              className="model-select"
              value={prefs.model}
              onChange={(e) => {
                const v = e.target.value;
                // Mirror into the mode-specific slot so it survives a
                // routeMode toggle.
                updatePrefs(
                  prefs.routeMode === "local"
                    ? { model: v, localModel: v }
                    : { model: v, remoteModel: v },
                );
              }}
              title="Select model"
            >
              {!models.includes(prefs.model) && prefs.model && (
                <option value={prefs.model}>{formatModelName(prefs.model)}</option>
              )}
              {models.map((m) => (
                <option key={m} value={m}>
                  {formatModelName(m)}
                </option>
              ))}
              {models.length === 0 && !prefs.model && (
                <option value="">Loading...</option>
              )}
            </select>
          </div>

          {/* GPU Stats */}
          {systemStats?.gpu && (
            <section className="inspector-section">
              <h4 className="inspector-section-title">
                <Cpu size={12} /> GPU
              </h4>
              <div className="gpu-compact">
                <div className="gpu-header">
                  <span className="gpu-label">Memory</span>
                  <span className="gpu-temp">{systemStats.gpu.temperature}°C</span>
                </div>
                <div className="gpu-bar-compact">
                  <div
                    className="gpu-bar-fill"
                    style={{ width: `${systemStats.gpu.memoryPercent}%` }}
                  />
                </div>
                <div className="gpu-stats">
                  <span>
                    {systemStats.gpu.memoryUsed}MB / {systemStats.gpu.memoryTotal}MB
                  </span>
                  <span>{systemStats.gpu.utilization}% util</span>
                </div>
              </div>
            </section>
          )}

          {/* Services */}
          {totalServices > 0 && (
            <section className="inspector-section">
              <h4 className="inspector-section-title">
                Services
                <span className="count-badge">
                  {onlineServices}/{totalServices}
                </span>
              </h4>
              <div className="inspector-services">
                {systemStats?.services.map((s) => (
                  <div key={s.name} className="service-row">
                    <span className={`service-dot ${s.status}`} />
                    <span className="service-name">{s.name}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Tool Calls */}
          {toolCalls.length > 0 && (
            <section className="inspector-section">
              <h4 className="inspector-section-title">
                <Wrench size={12} /> Tools
                <span className="count-badge">{toolCalls.length}</span>
              </h4>
              <div className="tool-calls-list">
                {toolCalls
                  .slice(-6)
                  .reverse()
                  .map((tc) =>
                    tc.status === "complete" && tc.result ? (
                      <ToolResultCard key={tc.id} tool={tc} />
                    ) : (
                      <ToolCallRow key={tc.id} tool={tc} />
                    )
                  )}
              </div>
            </section>
          )}

          {/* Artifacts */}
          {artifacts.length > 0 && (
            <section className="inspector-section">
              <h4 className="inspector-section-title">
                <FileText size={12} /> Files
                <span className="count-badge">{artifacts.length}</span>
              </h4>
              <div className="artifacts-grid">
                {artifacts.slice(-6).map((a, i) => (
                  <ArtifactThumb
                    key={i}
                    artifact={a}
                    onClick={() => setExpandedArtifact(a)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Empty state */}
          {!systemStats?.gpu && toolCalls.length === 0 && artifacts.length === 0 && (
            <div className="inspector-empty">
              <p>No active data.</p>
              <p>
                Start a chat or run to see tool calls, artifacts, and system stats here.
              </p>
            </div>
          )}
        </div>
      </aside>

      {/* Artifact Modal */}
      {expandedArtifact && (
        <ArtifactModal
          artifact={expandedArtifact}
          onClose={() => setExpandedArtifact(null)}
        />
      )}
    </>
  );
}

function ToolCallRow({ tool }: { tool: ToolCallData }) {
  const statusColor =
    tool.status === "complete"
      ? "success"
      : tool.status === "error"
      ? "error"
      : "running";
  const duration = tool.durationMs
    ? tool.durationMs > 1000
      ? `${(tool.durationMs / 1000).toFixed(1)}s`
      : `${tool.durationMs}ms`
    : null;

  return (
    <div className={`tool-call-row ${statusColor}`}>
      <div className="tool-call-header">
        <span className="tool-status-dot" />
        <span className="tool-name">{tool.name.replace(/_/g, " ")}</span>
        {duration && <span className="tool-duration">{duration}</span>}
        {tool.status === "running" && <span className="tool-spinner" />}
      </div>
    </div>
  );
}

function ArtifactThumb({
  artifact,
  onClick,
}: {
  artifact: Artifact;
  onClick: () => void;
}) {
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

function ArtifactModal({
  artifact,
  onClose,
}: {
  artifact: Artifact;
  onClose: () => void;
}) {
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
              <a href={artifact.url} download={artifact.name}>
                Download {artifact.name}
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
