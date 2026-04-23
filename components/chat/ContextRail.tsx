"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/warp/Icons";
import { useChatInspectorData } from "@/lib/hooks/useChatInspector";
import { useThreadManager } from "@/lib/hooks/useThreadManager";
import { useSystemStats } from "@/lib/hooks/useSystemStats";
import { useDeckSettings } from "@/components/settings/DeckSettingsProvider";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/llm/systemPrompt";
import { ThreadPromptSheet } from "@/components/chat/ThreadPromptSheet";
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
  const { model, route, isLoading, toolCalls, artifacts } = useChatInspectorData();
  const { prefs, setSettingsOpen } = useDeckSettings();
  const routeLabel =
    route === "free" ? "free-tier route" : route === "cloud" ? "cloud route" : "local route";
  const trimmedPrompt = prefs.systemPrompt.trim();
  const promptState: "default" | "custom" | "off" =
    !trimmedPrompt ? "off" : trimmedPrompt === DEFAULT_SYSTEM_PROMPT.trim() ? "default" : "custom";

  const { activeThreadId, threads, messages } = useThreadManager();
  const { stats } = useSystemStats();
  const activeThread = threads.find((thread) => thread.id === activeThreadId);

  // Per-thread override state — fetched lazily when the thread id changes,
  // and refetched when the edit sheet closes (in case a save happened).
  const [threadPromptOverride, setThreadPromptOverride] = useState<string | null>(null);
  const [threadSheetOpen, setThreadSheetOpen] = useState(false);
  useEffect(() => {
    if (!activeThreadId) {
      setThreadPromptOverride(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const r = await fetch(`/api/threads/${activeThreadId}/system-prompt`, { cache: "no-store" }).catch(() => null);
      if (!cancelled && r?.ok) {
        const d = (await r.json()) as { systemPrompt: string | null };
        setThreadPromptOverride(d.systemPrompt);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeThreadId, threadSheetOpen]);
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
              <span>{routeLabel}</span>
            </div>
          </div>
          <button
            type="button"
            className={`ctx-row ctx-row-button ctx-prompt-${promptState}`}
            onClick={() => setSettingsOpen(true)}
            title={
              promptState === "off"
                ? "No system prompt active — click to edit in Settings"
                : promptState === "custom"
                  ? "Custom system prompt — click to edit"
                  : "Default system prompt (language + brevity anchor) — click to customize"
            }
          >
            <Icon.Settings size={14} sw={1.2} />
            <div>
              <strong>System prompt</strong>
              <span>
                {promptState === "off"
                  ? "off — models using their own defaults"
                  : promptState === "custom"
                    ? `custom · ${trimmedPrompt.length} chars`
                    : "default · English + brevity anchor"}
              </span>
            </div>
          </button>
          {activeThreadId && (
            <button
              type="button"
              className={`ctx-row ctx-row-button ctx-prompt-${threadPromptOverride ? "custom" : "default"}`}
              onClick={() => setThreadSheetOpen(true)}
              title={
                threadPromptOverride
                  ? "This thread overrides the global prompt — click to edit"
                  : "This thread inherits the global prompt — click to set a thread-specific prompt"
              }
            >
              <Icon.Chat size={14} sw={1.2} />
              <div>
                <strong>Thread prompt</strong>
                <span>
                  {threadPromptOverride
                    ? `override · ${threadPromptOverride.length} chars`
                    : "inherits global"}
                </span>
              </div>
            </button>
          )}
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
      {threadSheetOpen && activeThreadId && (
        <ThreadPromptSheet
          threadId={activeThreadId}
          onClose={() => setThreadSheetOpen(false)}
        />
      )}
    </aside>
  );
}
