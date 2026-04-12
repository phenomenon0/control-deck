"use client";

import { Brain, Search, Code, Wrench, Volume2, Square, Loader2 } from "lucide-react";
import type { RunState } from "@/lib/types/agentRun";

// =============================================================================
// StatusStrip — persistent run status between timeline and composer
// Replaces the 6px blinking dot and scattered status text (DESIGN.md §3.5)
// =============================================================================

interface StatusStripProps {
  runState: RunState;
  /** Callback when user clicks Stop */
  onStop?: () => void;
  /** Elapsed milliseconds since run started */
  elapsedMs?: number;
}

/** Phase -> visual config mapping */
function getPhaseConfig(runState: RunState) {
  switch (runState.phase) {
    case "submitted":
      return {
        icon: Loader2,
        label: "Sending...",
        color: "var(--text-secondary)",
        pulse: true,
      };
    case "thinking":
      return {
        icon: Brain,
        label: "Reasoning...",
        color: "var(--agent-thinking)",
        pulse: true,
      };
    case "streaming":
      return {
        icon: null, // no icon during streaming — text is the signal
        label: "Responding...",
        color: "var(--text-secondary)",
        pulse: false,
      };
    case "executing":
      return {
        icon: getToolIcon(runState.toolName),
        label: `Using ${runState.toolName}...`,
        color: "var(--agent-working)",
        pulse: true,
      };
    case "resuming":
      return {
        icon: null,
        label: "Continuing...",
        color: "var(--text-secondary)",
        pulse: false,
      };
    case "error":
      return {
        icon: null,
        label: runState.error,
        color: "var(--error)",
        pulse: false,
      };
    default:
      return null; // idle — strip hidden
  }
}

function getToolIcon(toolName: string) {
  if (toolName.includes("search")) return Search;
  if (toolName.includes("code") || toolName === "execute_code") return Code;
  if (toolName.includes("audio")) return Volume2;
  return Wrench;
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return "<1s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function StatusStrip({ runState, onStop, elapsedMs }: StatusStripProps) {
  const config = getPhaseConfig(runState);

  // Hidden when idle
  if (!config) return null;

  const Icon = config.icon;

  return (
    <div
      style={{
        height: 36,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        fontSize: 12,
        color: config.color,
        opacity: 1,
        animation: "status-strip-enter var(--t-fast, 150ms) var(--ease-out, ease-out)",
      }}
    >
      {/* Phase icon */}
      {Icon && (
        <Icon
          size={14}
          className={config.pulse ? "status-icon-pulse" : ""}
          style={{ flexShrink: 0 }}
        />
      )}

      {/* Label */}
      <span style={{ fontWeight: 500 }}>{config.label}</span>

      {/* Elapsed time */}
      {elapsedMs != null && elapsedMs > 0 && runState.phase !== "error" && (
        <span
          style={{
            fontSize: 11,
            color: "var(--text-tertiary)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {formatElapsed(elapsedMs)}
        </span>
      )}

      {/* Stop button */}
      {onStop && runState.phase !== "error" && runState.phase !== "idle" && (
        <button
          onClick={onStop}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "3px 10px",
            fontSize: 11,
            fontWeight: 500,
            color: "var(--error)",
            background: "var(--error-muted)",
            border: "1px solid rgba(229, 83, 75, 0.2)",
            borderRadius: 9999,
            cursor: "pointer",
            marginLeft: 4,
            transition: "background var(--t-micro, 80ms) ease",
          }}
        >
          <Square size={10} fill="currentColor" />
          Stop
        </button>
      )}
    </div>
  );
}
