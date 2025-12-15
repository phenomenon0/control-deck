"use client";

import type { Artifact } from "./ArtifactRenderer";

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
  };
  artifacts?: Artifact[];
  startedAt?: number;
}

const TOOL_ICONS: Record<string, string> = {
  generate_image: "🎨",
  edit_image: "✏️",
  generate_audio: "🎵",
  image_to_3d: "🎲",
  analyze_image: "👁️",
  web_search: "🔍",
};

interface ToolCallCardProps {
  tool: ToolCallData;
  defaultExpanded?: boolean;
}

/**
 * Minimal inline tool indicator - just a small pill showing status
 */
export function ToolCallCard({ tool }: ToolCallCardProps) {
  const icon = TOOL_ICONS[tool.name] || "⚡";
  const name = tool.name.replace(/_/g, " ");

  const statusIndicator = {
    pending: { text: "...", color: "var(--text-muted)" },
    running: { text: "...", color: "var(--accent)" },
    complete: { text: "✓", color: "#4ade80" },
    error: { text: "✗", color: "#ef4444" },
  }[tool.status];

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 8px",
        background: "var(--bg-tertiary)",
        borderRadius: 12,
        fontSize: 11,
        color: "var(--text-muted)",
        marginRight: 6,
        marginBottom: 4,
      }}
    >
      <span style={{ fontSize: 11 }}>{icon}</span>
      <span>{name}</span>
      <span
        style={{
          color: statusIndicator.color,
          fontSize: 10,
          fontWeight: 600,
        }}
      >
        {statusIndicator.text}
      </span>
    </span>
  );
}
