"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { Artifact } from "./ArtifactRenderer";
import { STATUS_STYLES, formatDuration, type ToolStatus } from "@/lib/constants/status";

// =============================================================================
// Types
// =============================================================================

export type { ToolStatus };

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

/**
 * Unified props interface for ToolCallCard.
 *
 * Supports two usage patterns:
 *  1. Object style (chat):   <ToolCallCard tool={toolCallData} />
 *  2. Flat style   (dojo):   <ToolCallCard name="web_search" status="success" ... />
 *
 * When `tool` is provided the flat props are ignored.
 */
export interface ToolCallCardProps {
  // ---- Object style (chat) ----
  tool?: ToolCallData;
  defaultExpanded?: boolean;
  compact?: boolean;

  // ---- Flat style (dojo / agentgo) ----
  name?: string;
  args?: Record<string, unknown>;
  result?: string;
  status?: ToolStatus;
  duration?: number;
  error?: string;
  isCollapsible?: boolean;
}

// =============================================================================
// Tool Display Config
// =============================================================================

const TOOL_CONFIG: Record<string, { icon: string; label: string }> = {
  generate_image: { icon: "🖼️", label: "Image" },
  edit_image: { icon: "✏️", label: "Edit" },
  generate_audio: { icon: "🔊", label: "Audio" },
  image_to_3d: { icon: "🎲", label: "3D" },
  analyze_image: { icon: "👁️", label: "Vision" },
  web_search: { icon: "🔍", label: "Search" },
  glyph_motif: { icon: "✨", label: "Glyph" },
  execute_code: { icon: "💻", label: "Code" },
  vector_search: { icon: "📚", label: "Lookup" },
  vector_store: { icon: "💾", label: "Store" },
};

const DEFAULT_CONFIG = { icon: "🔧", label: "Tool" };

// Keys to show as the "prompt" or main argument
const PROMPT_KEYS = ["prompt", "query", "instruction", "code", "text", "question", "message"];

// =============================================================================
// ToolCallCard Component
// =============================================================================

export function ToolCallCard(props: ToolCallCardProps) {
  // Normalise into a single internal representation regardless of which
  // prop-style the caller used.
  const resolved = resolveProps(props);

  const {
    toolName,
    args,
    richResult,
    plainResult,
    plainError,
    effectiveStatus,
    durationMs,
    compact,
    defaultExpanded,
    isCollapsible,
  } = resolved;

  const [isExpanded, setIsExpanded] = useState(
    defaultExpanded ?? (isCollapsible === false)
  );

  const config = TOOL_CONFIG[toolName] || DEFAULT_CONFIG;
  const styles = STATUS_STYLES[effectiveStatus];
  const mainPrompt = getMainPrompt(args);

  // Determine whether the card has expandable details
  const hasDetails =
    mainPrompt ||
    (args && Object.keys(args).length > 0) ||
    richResult ||
    plainResult ||
    plainError;

  const canToggle = isCollapsible !== false && hasDetails;

  // ---------------------------------------------------------------------------
  // Compact pill mode
  // ---------------------------------------------------------------------------
  if (compact) {
    const compactDotColor = effectiveStatus === "running" ? "var(--accent)"
      : effectiveStatus === "complete" || effectiveStatus === "success" ? "var(--success)"
      : effectiveStatus === "error" ? "var(--error)"
      : "var(--text-muted)";

    return (
      <span
        className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] mr-1 mb-1"
        style={{
          border: "1px solid var(--border)",
          background: "var(--bg-primary)",
          color: "var(--text-secondary)",
        }}
      >
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: compactDotColor, flexShrink: 0 }} />
        <span className="font-medium">{config.label}</span>
      </span>
    );
  }

  // ---------------------------------------------------------------------------
  // Full card - Apple Physical style
  // ---------------------------------------------------------------------------

  const dotColor = effectiveStatus === "running" ? "var(--accent)"
    : effectiveStatus === "complete" || effectiveStatus === "success" ? "var(--success)"
    : effectiveStatus === "error" ? "var(--error)"
    : "var(--text-muted)";

  const dotClass = effectiveStatus === "running" ? "animate-status-pulse" : "";
  const cardClass = ""; // No shake animation — errors shown inline

  return (
    <div
      className={`overflow-hidden my-2 max-w-md ${cardClass}`}
      style={{
        borderRadius: 6,
        border: "1px solid var(--border)",
        background: "rgba(255, 255, 255, 0.02)",
      }}
    >
      {/* Header - compact single line */}
      <button
        onClick={() => canToggle && setIsExpanded(!isExpanded)}
        disabled={!canToggle}
        className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left ${
          canToggle ? "hover:bg-[var(--bg-secondary)] cursor-pointer" : "cursor-default"
        }`}
        style={{ transition: "background 150ms cubic-bezier(0, 0, 0.2, 1)" }}
      >
        {/* Status Dot */}
        <span
          className={`shrink-0 ${dotClass}`}
          style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor }}
        />

        {/* Tool Name */}
        <span className="text-sm font-medium text-[var(--text-primary)]">
          {config.label}
        </span>

        {/* Main Prompt Preview (truncated) - shown when collapsed & prompt exists */}
        {mainPrompt && !isExpanded && (
          <span className="flex-1 text-xs text-[var(--text-muted)] truncate ml-0.5">
            {truncate(mainPrompt, 40)}
          </span>
        )}

        {/* Spacer */}
        {!(mainPrompt && !isExpanded) && <span className="flex-1" />}

        {/* Duration */}
        {durationMs !== undefined && effectiveStatus !== "running" && (
          <span className="text-[10px] font-mono text-[var(--text-muted)]">
            {formatDuration(durationMs)}
          </span>
        )}

        {/* Spinner or Chevron */}
        {effectiveStatus === "running" ? (
          <div className="tool-spinner" />
        ) : canToggle ? (
          <ChevronDown
            className="w-3.5 h-3.5 text-[var(--text-muted)]"
            style={{
              transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 150ms cubic-bezier(0, 0, 0.2, 1)",
            }}
          />
        ) : null}
      </button>

      {/* Expanded Content */}
      {isExpanded && hasDetails && (
        <div className="animate-expand px-3 pb-3 space-y-2 border-t border-[var(--border)]">
          {/* Main Prompt (chat-style rich view) */}
          {mainPrompt && (
            <div className="pt-2">
              <div className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1">
                Input
              </div>
              <div className="text-xs font-mono p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border)] whitespace-pre-wrap break-words leading-relaxed">
                {mainPrompt}
              </div>
            </div>
          )}

          {/* Other Args (parameter pills for chat, or raw JSON for dojo) */}
          {args && Object.keys(args).filter((k) => !PROMPT_KEYS.includes(k)).length > 0 && (
            <div>
              <div className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1">
                Parameters
              </div>
              {/* If there's a main prompt we show non-prompt args as pills; otherwise show raw JSON */}
              {mainPrompt ? (
                <div className="flex flex-wrap gap-1">
                  {Object.entries(args)
                    .filter(([key]) => !PROMPT_KEYS.includes(key))
                    .map(([key, value]) => (
                      <span
                        key={key}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] border border-[var(--border)] text-[var(--text-secondary)]"
                      >
                        <span className="text-[var(--text-muted)]">{key}:</span>{" "}
                        <span className="font-mono">{formatArg(value)}</span>
                      </span>
                    ))}
                </div>
              ) : (
                <pre className="text-xs font-mono p-2 rounded bg-[var(--bg-primary)] border border-[var(--border)] overflow-x-auto">
                  {JSON.stringify(
                    Object.fromEntries(
                      Object.entries(args).filter(([k]) => !PROMPT_KEYS.includes(k))
                    ),
                    null,
                    2,
                  )}
                </pre>
              )}
            </div>
          )}

          {/* Full args JSON fallback (dojo-style, when no main prompt detected) */}
          {args && !mainPrompt && Object.keys(args).filter((k) => !PROMPT_KEYS.includes(k)).length === 0 && Object.keys(args).length > 0 && (
            <div>
              <div className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1">
                Arguments
              </div>
              <pre className="text-xs font-mono p-2 rounded bg-[var(--bg-primary)] border border-[var(--border)] overflow-x-auto">
                {JSON.stringify(args, null, 2)}
              </pre>
            </div>
          )}

          {/* Rich result (from chat ToolCallData) */}
          {richResult && (
            <div>
              {/* Error */}
              {richResult.error && richResult.error.trim() && (
                <div className="mb-2">
                  <div className="text-[10px] font-semibold text-red-400 uppercase tracking-wide mb-1">
                    Error
                  </div>
                  <div className="text-sm p-2 rounded bg-red-500/10 border border-red-500/30 text-red-400 whitespace-pre-wrap break-words">
                    {richResult.error}
                  </div>
                </div>
              )}

              {/* Search results */}
              {toolName === "web_search" && richResult.data && (
                <SearchResultsDisplay data={richResult.data} />
              )}

              {/* Message */}
              {richResult.message && !richResult.error && toolName !== "web_search" && (
                <div>
                  <div className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1">
                    Result
                  </div>
                  <div className="text-sm p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border)] whitespace-pre-wrap break-words">
                    {richResult.message}
                  </div>
                </div>
              )}

              {/* Raw data (non-search, no message) */}
              {richResult.data && !richResult.message && toolName !== "web_search" && (
                <div>
                  <div className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1 flex items-center gap-1.5">
                    Data
                    {"_glyph" in (richResult.data as Record<string, unknown>) && (
                      <span className="text-[9px] px-1.5 py-px bg-purple-500/20 text-purple-400 rounded font-medium">
                        GLYPH
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] font-mono p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border)] whitespace-pre-wrap break-words max-h-[200px] overflow-auto">
                    {(richResult.data as Record<string, unknown>)?._glyph
                      ? String((richResult.data as Record<string, unknown>)._glyph)
                      : JSON.stringify(richResult.data, null, 2)}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Plain result string (from dojo flat props) */}
          {!richResult && plainResult && (
            <div>
              <div className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1">
                Result
              </div>
              <div className="text-sm p-2 rounded bg-[var(--bg-primary)] border border-[var(--border)]">
                {plainResult}
              </div>
            </div>
          )}

          {/* Plain error string (from dojo flat props) */}
          {!richResult && plainError && (
            <div>
              <div className="text-[10px] font-semibold text-red-400 uppercase tracking-wide mb-1">
                Error
              </div>
              <div className="text-sm p-2 rounded bg-red-500/10 border border-red-500/30 text-red-400">
                {plainError}
              </div>
            </div>
          )}
        </div>
      )}
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
  const results = (data.results as SearchResult[]) || [];
  const count = (data.count as number) || results.length;

  if (results.length === 0) {
    return (
      <div className="text-xs text-[var(--text-muted)] italic">
        No results found
      </div>
    );
  }

  return (
    <div>
      <div className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">
        Results ({count})
      </div>
      <div className="flex flex-col gap-2">
        {results.slice(0, 5).map((result, idx) => (
          <div
            key={idx}
            className="p-2 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)]"
          >
            <a
              href={result.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-blue-400 block mb-1 hover:underline"
            >
              {result.title || "Untitled"}
            </a>
            <div className="text-[10px] text-[var(--text-muted)] mb-1 truncate">
              {result.url}
            </div>
            {result.snippet && (
              <div className="text-[11px] text-[var(--text-secondary)] leading-snug">
                {result.snippet}
              </div>
            )}
            {result.publishedDate && (
              <div className="text-[10px] text-[var(--text-muted)] mt-1">
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

interface ResolvedProps {
  toolName: string;
  args?: Record<string, unknown>;
  richResult?: ToolCallData["result"];
  plainResult?: string;
  plainError?: string;
  effectiveStatus: ToolStatus;
  durationMs?: number;
  compact: boolean;
  defaultExpanded?: boolean;
  isCollapsible?: boolean;
}

/** Normalise the two calling conventions into a single internal shape. */
function resolveProps(props: ToolCallCardProps): ResolvedProps {
  if (props.tool) {
    const tool = props.tool;
    return {
      toolName: tool.name,
      args: tool.args,
      richResult: tool.result,
      plainResult: undefined,
      plainError: undefined,
      effectiveStatus: getEffectiveStatus(tool),
      durationMs: tool.durationMs,
      compact: props.compact ?? false,
      defaultExpanded: props.defaultExpanded,
      isCollapsible: undefined, // chat style is always collapsible when there are details
    };
  }

  // Flat props (dojo / agentgo style)
  // Map "success" to "complete" for STATUS_STYLES lookup consistency
  const rawStatus = props.status ?? "pending";

  return {
    toolName: props.name ?? "unknown",
    args: props.args,
    richResult: undefined,
    plainResult: props.result,
    plainError: props.error,
    effectiveStatus: rawStatus,
    durationMs: props.duration,
    compact: props.compact ?? false,
    defaultExpanded: undefined,
    isCollapsible: props.isCollapsible,
  };
}

function getEffectiveStatus(tool: ToolCallData): ToolStatus {
  if (tool.status === "error") return "error";
  if (tool.status === "complete") {
    const hasError =
      tool.result?.success === false &&
      tool.result?.error &&
      tool.result.error.trim();
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
  if (typeof value === "string")
    return value.length > 30 ? value.slice(0, 30) + "..." : value;
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
    <div className="flex flex-wrap gap-1 mt-2">
      {tools.map((tool) => (
        <ToolCallCard key={tool.id} tool={tool} compact />
      ))}
    </div>
  );
}
