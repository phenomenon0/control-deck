"use client";

import { Icon } from "@/components/warp/Icons";
import { useChatInspectorData } from "@/lib/hooks/useChatInspector";
import { useThreadManager } from "@/lib/hooks/useThreadManager";
import { useSystemStats } from "@/lib/hooks/useSystemStats";
import type { Artifact, ToolCallData } from "@/lib/types/chat";
import { openArtifactInCanvas } from "@/lib/canvas";

function formatModelLabel(model: string): string {
  if (!model) return "model pending";
  const parts = model.split(/[/\\]/);
  return parts[parts.length - 1].replace(/\.gguf$/i, "");
}

function formatDuration(ms?: number): string {
  if (!ms) return "";
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

function artifactKind(artifact: Artifact): string {
  if (artifact.mimeType?.startsWith("image/")) return "image";
  if (artifact.mimeType?.startsWith("audio/")) return "audio";
  if (artifact.mimeType?.includes("csv")) return "csv";
  if (artifact.mimeType?.includes("json")) return "json";
  return "file";
}

function toolStatusLabel(tool: ToolCallData): string {
  if (tool.status === "running") return "running";
  if (tool.status === "error") return "error";
  return "done";
}

export function ContextRail() {
  const { model, isLoading, toolCalls, artifacts } = useChatInspectorData();
  const { activeThreadId, threads, messages } = useThreadManager();
  const { stats } = useSystemStats();
  const activeThread = threads.find((thread) => thread.id === activeThreadId);
  const latestTools = toolCalls.slice(-5).reverse();
  const latestArtifacts = artifacts.slice(-4).reverse();
  const messageCount = messages.length;
  const gpu = stats?.gpu;

  return (
    <aside className="cs-context" aria-label="Thread context">
      <section className="ctx-section">
        <div className="ctx-section-head">
          <span>Artifacts</span>
          <span>{artifacts.length}</span>
        </div>
        {latestArtifacts.length > 0 ? (
          <div className="ctx-artifact-grid">
            {latestArtifacts.map((artifact, index) => (
              <button
                key={`${artifact.id}-${index}`}
                type="button"
                className="ctx-artifact"
                onClick={() => openArtifactInCanvas(artifact)}
                title={`Open ${artifact.name} in Canvas`}
              >
                {artifact.mimeType?.startsWith("image/") ? (
                  <img src={artifact.url} alt="" />
                ) : (
                  <Icon.Box size={16} sw={1.2} />
                )}
                <span>{artifact.name || artifactKind(artifact)}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="ctx-empty">Files will land here.</div>
        )}
      </section>

      <section className="ctx-section">
        <div className="ctx-section-head">
          <span>Context</span>
          <span>{isLoading ? "live" : "ready"}</span>
        </div>
        <div className="ctx-stack">
          <div className="ctx-row">
            <Icon.Chat size={14} sw={1.2} />
            <div>
              <strong>{activeThread?.title || "New thread"}</strong>
              <span>{messageCount} messages</span>
            </div>
          </div>
          <div className="ctx-row">
            <Icon.Cpu size={14} sw={1.2} />
            <div>
              <strong>{formatModelLabel(model)}</strong>
              <span>local route</span>
            </div>
          </div>
          {gpu && (
            <div className="ctx-row">
              <Icon.Grid size={14} sw={1.2} />
              <div>
                <strong>{gpu.memoryUsed} / {gpu.memoryTotal} MB</strong>
                <span>{gpu.utilization}% GPU / {gpu.temperature}C</span>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="ctx-section">
        <div className="ctx-section-head">
          <span>Run Trace</span>
          <span>{toolCalls.length}</span>
        </div>
        {latestTools.length > 0 ? (
          <div className="ctx-tool-list">
            {latestTools.map((tool, index) => (
              <div key={`${tool.id}-${index}`} className={`ctx-tool ctx-tool--${tool.status}`}>
                <span className="ctx-tool-dot" />
                <span className="ctx-tool-name">{tool.name.replace(/_/g, " ")}</span>
                <span className="ctx-tool-meta">
                  {formatDuration(tool.durationMs) || toolStatusLabel(tool)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="ctx-empty">Tool calls will appear as they run.</div>
        )}
      </section>
    </aside>
  );
}
