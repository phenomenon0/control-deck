"use client";

import { useState } from "react";
import type { Artifact } from "./ArtifactRenderer";

// =============================================================================
// Types
// =============================================================================

export type ToolStatus = "pending" | "running" | "complete" | "error";

export interface ToolCallData {
  id: string;
  name: string;
  args?: Record<string, unknown>;
  status: ToolStatus;
  result?: {
    success: boolean;
    message?: string;
    error?: string;
    data?: Record<string, unknown>;
  };
  artifacts?: Artifact[];
  startedAt?: number;
  durationMs?: number;
}

// =============================================================================
// Tool Display Config
// =============================================================================

const TOOL_CONFIG: Record<string, { icon: string; label: string; color: string }> = {
  generate_image: { icon: "🖼️", label: "Image", color: "#8b5cf6" },
  edit_image: { icon: "✏️", label: "Edit", color: "#8b5cf6" },
  generate_audio: { icon: "🔊", label: "Audio", color: "#f59e0b" },
  image_to_3d: { icon: "🎲", label: "3D", color: "#ec4899" },
  analyze_image: { icon: "👁️", label: "Vision", color: "#06b6d4" },
  web_search: { icon: "🔍", label: "Search", color: "#3b82f6" },
  glyph_motif: { icon: "✨", label: "Glyph", color: "#a855f7" },
  execute_code: { icon: "💻", label: "Code", color: "#22c55e" },
  vector_search: { icon: "📚", label: "Lookup", color: "#6366f1" },
  vector_store: { icon: "💾", label: "Store", color: "#6366f1" },
};

const DEFAULT_CONFIG = { icon: "🔧", label: "Tool", color: "#6b7280" };

// Keys to show as the "prompt" or main argument
const PROMPT_KEYS = ["prompt", "query", "instruction", "code", "text", "question", "message"];

// =============================================================================
// Status Styles
// =============================================================================

const STATUS_STYLES = {
  pending: {
    border: "rgba(107, 114, 128, 0.3)",
    bg: "rgba(107, 114, 128, 0.05)",
    dot: "#6b7280",
    text: "#9ca3af",
    label: "Pending",
  },
  running: {
    border: "rgba(59, 130, 246, 0.3)",
    bg: "rgba(59, 130, 246, 0.05)",
    dot: "#3b82f6",
    text: "#60a5fa",
    label: "Running",
  },
  complete: {
    border: "rgba(34, 197, 94, 0.3)",
    bg: "rgba(34, 197, 94, 0.05)",
    dot: "#22c55e",
    text: "#4ade80",
    label: "Complete",
  },
  error: {
    border: "rgba(239, 68, 68, 0.3)",
    bg: "rgba(239, 68, 68, 0.05)",
    dot: "#ef4444",
    text: "#f87171",
    label: "Error",
  },
};

// =============================================================================
// ToolCallCard Component
// =============================================================================

interface ToolCallCardProps {
  tool: ToolCallData;
  defaultExpanded?: boolean;
  compact?: boolean;
}

export function ToolCallCard({ tool, defaultExpanded = false, compact = false }: ToolCallCardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  
  const config = TOOL_CONFIG[tool.name] || DEFAULT_CONFIG;
  const effectiveStatus = getEffectiveStatus(tool);
  const styles = STATUS_STYLES[effectiveStatus];
  const mainPrompt = getMainPrompt(tool.args);
  const hasDetails = mainPrompt || (tool.args && Object.keys(tool.args).length > 0) || tool.result;

  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  // Compact mode - just a pill
  if (compact) {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "2px 8px",
          background: styles.bg,
          border: `1px solid ${styles.border}`,
          borderRadius: 12,
          fontSize: 11,
          color: styles.text,
          marginRight: 4,
          marginBottom: 4,
        }}
      >
        <span>{config.icon}</span>
        <span style={{ fontWeight: 500 }}>{config.label}</span>
        {effectiveStatus === "running" && (
          <span
            style={{
              width: 4,
              height: 4,
              borderRadius: "50%",
              background: styles.dot,
              animation: "pulse 1.5s infinite",
            }}
          />
        )}
      </span>
    );
  }

  return (
    <div
      style={{
        borderRadius: 8,
        border: `1px solid ${styles.border}`,
        background: styles.bg,
        overflow: "hidden",
        marginTop: 8,
        marginBottom: 8,
        maxWidth: 450,
      }}
    >
      {/* Header */}
      <button
        onClick={() => hasDetails && setIsExpanded(!isExpanded)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          background: "transparent",
          border: "none",
          cursor: hasDetails ? "pointer" : "default",
          textAlign: "left",
          font: "inherit",
          color: "inherit",
        }}
      >
        {/* Status Dot */}
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: styles.dot,
            flexShrink: 0,
            animation: effectiveStatus === "running" ? "pulse 1.5s infinite" : "none",
          }}
        />

        {/* Tool Icon */}
        <span style={{ fontSize: 16 }}>{config.icon}</span>

        {/* Tool Name */}
        <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>
          {config.label}
        </span>

        {/* Main Prompt Preview (truncated) */}
        {mainPrompt && !isExpanded && (
          <span
            style={{
              flex: 1,
              fontSize: 12,
              color: "var(--text-muted)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              marginLeft: 4,
            }}
          >
            {truncate(mainPrompt, 40)}
          </span>
        )}

        {/* Spacer */}
        <span style={{ flex: mainPrompt && !isExpanded ? 0 : 1 }} />

        {/* Status Label */}
        <span style={{ fontSize: 11, color: styles.text }}>
          {effectiveStatus === "running" ? "Running..." : styles.label}
        </span>

        {/* Duration */}
        {tool.durationMs !== undefined && effectiveStatus !== "running" && (
          <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "ui-monospace, monospace" }}>
            {formatDuration(tool.durationMs)}
          </span>
        )}

        {/* Spinner or Chevron */}
        {effectiveStatus === "running" ? (
          <span
            style={{
              width: 12,
              height: 12,
              border: "2px solid var(--border)",
              borderTopColor: styles.dot,
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
            }}
          />
        ) : hasDetails ? (
          <svg
            width={12}
            height={12}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            style={{
              color: "var(--text-muted)",
              transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.15s",
            }}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        ) : null}
      </button>

      {/* Expanded Content */}
      {isExpanded && hasDetails && (
        <div
          style={{
            padding: "8px 12px",
            borderTop: `1px solid ${styles.border}`,
            background: "var(--bg-primary)",
          }}
        >
          {/* Main Prompt */}
          {mainPrompt && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>
                Input
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--text-primary)",
                  fontFamily: "ui-monospace, monospace",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  lineHeight: 1.5,
                  padding: 8,
                  background: "var(--bg-secondary)",
                  borderRadius: 4,
                  border: "1px solid var(--border)",
                }}
              >
                {mainPrompt}
              </div>
            </div>
          )}

          {/* Other Args */}
          {tool.args && Object.keys(tool.args).filter(k => !PROMPT_KEYS.includes(k)).length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>
                Parameters
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {Object.entries(tool.args)
                  .filter(([key]) => !PROMPT_KEYS.includes(key))
                  .map(([key, value]) => (
                    <span
                      key={key}
                      style={{
                        fontSize: 10,
                        padding: "2px 6px",
                        background: "var(--bg-tertiary)",
                        border: "1px solid var(--border)",
                        borderRadius: 4,
                        color: "var(--text-secondary)",
                      }}
                    >
                      <span style={{ color: "var(--text-muted)" }}>{key}:</span>{" "}
                      <span style={{ fontFamily: "ui-monospace, monospace" }}>{formatArg(value)}</span>
                    </span>
                  ))}
              </div>
            </div>
          )}

          {/* Result */}
          {tool.result && (
            <div>
              {/* Show error only if there's an actual error message */}
              {tool.result.error && tool.result.error.trim() && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: "#ef4444", textTransform: "uppercase", marginBottom: 4 }}>
                    Error
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "#f87171",
                      padding: 8,
                      background: "rgba(239, 68, 68, 0.1)",
                      borderRadius: 4,
                      border: "1px solid rgba(239, 68, 68, 0.3)",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {tool.result.error}
                  </div>
                </div>
              )}
              
              {/* Show search results nicely */}
              {tool.name === "web_search" && tool.result.data && (
                <SearchResultsDisplay data={tool.result.data} />
              )}
              
              {/* Show message if present */}
              {tool.result.message && !tool.result.error && tool.name !== "web_search" && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>
                    Result
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--text-secondary)",
                      padding: 8,
                      background: "var(--bg-secondary)",
                      borderRadius: 4,
                      border: "1px solid var(--border)",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {tool.result.message}
                  </div>
                </div>
              )}
              
              {/* Show raw data for other tools (if no message and not search) */}
              {tool.result.data && !tool.result.message && tool.name !== "web_search" && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>
                    Data
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--text-secondary)",
                      padding: 8,
                      background: "var(--bg-secondary)",
                      borderRadius: 4,
                      border: "1px solid var(--border)",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      fontFamily: "ui-monospace, monospace",
                      maxHeight: 200,
                      overflow: "auto",
                    }}
                  >
                    {JSON.stringify(tool.result.data, null, 2)}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

// =============================================================================
// Search Results Display
// =============================================================================

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
}

function SearchResultsDisplay({ data }: { data: Record<string, unknown> }) {
  // Handle both direct results array and nested structure
  const results = (data.results as SearchResult[]) || [];
  const count = (data.count as number) || results.length;
  
  if (results.length === 0) {
    return (
      <div style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
        No results found
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 6 }}>
        Results ({count})
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {results.slice(0, 5).map((result, idx) => (
          <div
            key={idx}
            style={{
              padding: 8,
              background: "var(--bg-secondary)",
              borderRadius: 6,
              border: "1px solid var(--border)",
            }}
          >
            {/* Title with link */}
            <a
              href={result.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: "#60a5fa",
                textDecoration: "none",
                display: "block",
                marginBottom: 4,
              }}
            >
              {result.title || "Untitled"}
            </a>
            
            {/* URL */}
            <div
              style={{
                fontSize: 10,
                color: "var(--text-muted)",
                marginBottom: 4,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {result.url}
            </div>
            
            {/* Snippet */}
            {result.snippet && (
              <div
                style={{
                  fontSize: 11,
                  color: "var(--text-secondary)",
                  lineHeight: 1.4,
                }}
              >
                {result.snippet}
              </div>
            )}
            
            {/* Published date */}
            {result.publishedDate && (
              <div
                style={{
                  fontSize: 10,
                  color: "var(--text-muted)",
                  marginTop: 4,
                }}
              >
                {result.publishedDate}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// Helpers
// =============================================================================

function getEffectiveStatus(tool: ToolCallData): ToolStatus {
  if (tool.status === "error") return "error";
  if (tool.status === "complete") {
    // Only mark as error if success is explicitly false AND there's an actual error message
    const hasError = tool.result?.success === false && tool.result?.error && tool.result.error.trim();
    return hasError ? "error" : "complete";
  }
  return tool.status;
}

function getMainPrompt(args?: Record<string, unknown>): string | null {
  if (!args) return null;
  for (const key of PROMPT_KEYS) {
    if (args[key] && typeof args[key] === "string") {
      return args[key] as string;
    }
  }
  return null;
}

function formatArg(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value.length > 30 ? value.slice(0, 30) + "..." : value;
  if (Array.isArray(value)) return `[${value.length}]`;
  return "{...}";
}

function truncate(str: string, max: number): string {
  return str.length <= max ? str : str.slice(0, max) + "...";
}

// =============================================================================
// Compact Tool Pills (for inline display)
// =============================================================================

export function ToolCallPills({ tools }: { tools: ToolCallData[] }) {
  if (tools.length === 0) return null;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
      {tools.map((tool) => (
        <ToolCallCard key={tool.id} tool={tool} compact />
      ))}
    </div>
  );
}
