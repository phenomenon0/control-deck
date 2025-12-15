"use client";

import React, { useEffect, useState, useRef } from "react";
import { useDeckSettings } from "@/components/settings/DeckSettingsProvider";
import { ToolCallTimeline, type ToolCallEvent } from "./ToolCallTimeline";
import { ArtifactList, type ArtifactItem } from "./ArtifactList";

// =============================================================================
// Types
// =============================================================================

interface RunInfo {
  runId: string;
  model: string;
  status: "running" | "completed" | "error";
  startedAt: number;
}

interface SSEEvent {
  type: string;
  runId?: string;
  threadId?: string;
  toolCallId?: string;
  toolName?: string;
  artifactId?: string;
  mimeType?: string;
  url?: string;
  name?: string;
  model?: string;
  result?: {
    success: boolean;
    message?: string;
    error?: string;
  };
}

// =============================================================================
// InspectorDrawer
// =============================================================================

interface InspectorDrawerProps {
  threadId: string | null;
}

export function InspectorDrawer({ threadId }: InspectorDrawerProps) {
  const { inspectorOpen, setInspectorOpen } = useDeckSettings();
  const [currentRun, setCurrentRun] = useState<RunInfo | null>(null);
  const [toolCalls, setToolCalls] = useState<ToolCallEvent[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactItem[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Subscribe to SSE events when drawer is open and we have a threadId
  useEffect(() => {
    if (!inspectorOpen || !threadId) {
      return;
    }

    // Clean up previous connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const eventSource = new EventSource(`/api/agui/stream?threadId=${threadId}`);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (e) => {
      try {
        const event: SSEEvent = JSON.parse(e.data);

        switch (event.type) {
          case "RunStarted":
            setCurrentRun({
              runId: event.runId || "",
              model: event.model || "unknown",
              status: "running",
              startedAt: Date.now(),
            });
            // Clear previous data for new run
            setToolCalls([]);
            setArtifacts([]);
            break;

          case "RunCompleted":
            setCurrentRun((prev) =>
              prev ? { ...prev, status: "completed" } : null
            );
            break;

          case "RunError":
            setCurrentRun((prev) =>
              prev ? { ...prev, status: "error" } : null
            );
            break;

          case "ToolCallStart":
            setToolCalls((prev) => [
              ...prev,
              {
                id: event.toolCallId || crypto.randomUUID(),
                name: event.toolName || "unknown",
                status: "running",
                startedAt: Date.now(),
              },
            ]);
            break;

          case "ToolCallResult":
            setToolCalls((prev) =>
              prev.map((tc) =>
                tc.id === event.toolCallId
                  ? {
                      ...tc,
                      status: event.result?.success ? "complete" : "error",
                      result: event.result,
                      completedAt: Date.now(),
                    }
                  : tc
              )
            );
            break;

          case "ArtifactCreated":
            setArtifacts((prev) => [
              ...prev,
              {
                id: event.artifactId || crypto.randomUUID(),
                name: event.name || "Artifact",
                mimeType: event.mimeType || "application/octet-stream",
                url: event.url || "",
              },
            ]);
            break;
        }
      } catch {
        // Ignore parse errors
      }
    };

    eventSource.onerror = () => {
      // Connection error - will auto-reconnect
    };

    return () => {
      eventSource.close();
    };
  }, [inspectorOpen, threadId]);

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && inspectorOpen) {
        e.preventDefault();
        setInspectorOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [inspectorOpen, setInspectorOpen]);

  if (!inspectorOpen) return null;

  return (
    <div className="fixed inset-0 z-50 pointer-events-none">
      {/* Backdrop - only captures clicks */}
      <button
        className="absolute inset-0 bg-black/30 pointer-events-auto"
        onClick={() => setInspectorOpen(false)}
        aria-label="Close inspector"
      />

      {/* Panel */}
      <div className="absolute right-0 top-0 h-full w-full max-w-sm bg-[var(--bg-primary)] border-l border-[var(--border)] shadow-2xl overflow-hidden flex flex-col pointer-events-auto animate-slide-in-right">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
          <div className="flex items-center gap-2">
            <InspectorIcon size={16} />
            <span className="text-sm font-semibold">Inspector</span>
          </div>
          <div className="flex items-center gap-2">
            <kbd className="kbd text-xs">Esc</kbd>
            <button
              className="p-1.5 rounded-md hover:bg-[var(--bg-tertiary)] transition-colors"
              onClick={() => setInspectorOpen(false)}
              aria-label="Close"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Run Info */}
          <section className="p-4 border-b border-[var(--border)]">
            <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">
              Current Run
            </h3>
            {currentRun ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[var(--text-secondary)]">Model</span>
                  <span className="text-sm font-mono text-[var(--text-primary)]">
                    {currentRun.model}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[var(--text-secondary)]">Status</span>
                  <StatusBadge status={currentRun.status} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[var(--text-secondary)]">Run ID</span>
                  <span className="text-xs font-mono text-[var(--text-muted)] truncate max-w-[150px]">
                    {currentRun.runId.slice(0, 8)}...
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-[var(--text-muted)]">No active run</p>
            )}
          </section>

          {/* Tool Calls */}
          <section className="p-4 border-b border-[var(--border)]">
            <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">
              Tool Calls ({toolCalls.length})
            </h3>
            {toolCalls.length > 0 ? (
              <ToolCallTimeline events={toolCalls} />
            ) : (
              <p className="text-sm text-[var(--text-muted)]">No tool calls yet</p>
            )}
          </section>

          {/* Artifacts */}
          <section className="p-4">
            <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">
              Artifacts ({artifacts.length})
            </h3>
            {artifacts.length > 0 ? (
              <ArtifactList items={artifacts} />
            ) : (
              <p className="text-sm text-[var(--text-muted)]">No artifacts generated</p>
            )}
          </section>
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-[var(--border)] bg-[var(--bg-secondary)] text-xs text-[var(--text-muted)]">
          {threadId ? `Thread: ${threadId.slice(0, 8)}...` : "No thread selected"}
        </div>
      </div>

      <style jsx>{`
        @keyframes slideInRight {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0);
          }
        }
        .animate-slide-in-right {
          animation: slideInRight 0.2s ease-out;
        }
      `}</style>
    </div>
  );
}

// =============================================================================
// Sub-components
// =============================================================================

function StatusBadge({ status }: { status: "running" | "completed" | "error" }) {
  const styles: Record<string, string> = {
    running: "bg-blue-500/20 text-blue-400",
    completed: "bg-green-500/20 text-green-400",
    error: "bg-red-500/20 text-red-400",
  };

  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${styles[status]}`}>
      {status === "running" && (
        <span className="inline-block w-1.5 h-1.5 bg-blue-400 rounded-full mr-1.5 animate-pulse" />
      )}
      {status}
    </span>
  );
}

function InspectorIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}
