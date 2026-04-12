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
      role="status"
      aria-live="polite"
      aria-label={config.label}
      className="status-strip"
      style={{ color: config.color }}
    >
      {Icon && (
        <Icon
          size={14}
          className={config.pulse ? "status-icon-pulse" : ""}
          style={{ flexShrink: 0 }}
        />
      )}

      <span className="status-strip-label">{config.label}</span>

      {elapsedMs != null && elapsedMs > 0 && runState.phase !== "error" && (
        <span className="status-strip-elapsed">
          {formatElapsed(elapsedMs)}
        </span>
      )}

      {onStop && runState.phase !== "error" && runState.phase !== "idle" && (
        <button onClick={onStop} className="status-strip-stop">
          <Square size={10} fill="currentColor" />
          Stop
        </button>
      )}
    </div>
  );
}
