// Shared Status Styles & Utilities
// Single source of truth for tool-call status styling and duration formatting.
// Used by components/chat/ToolCallCard.tsx and components/dojo/ui/ToolCallCard.tsx

export const STATUS_STYLES = {
  pending: {
    border: "border-[var(--border)]",
    bg: "bg-[var(--bg-primary)]",
    dot: "bg-[var(--text-muted)]",
    text: "text-[var(--text-muted)]",
    label: "Pending",
  },
  running: {
    border: "border-[var(--border)]",
    bg: "bg-[var(--bg-primary)]",
    dot: "bg-[var(--accent)] animate-status-pulse",
    text: "text-[var(--accent)]",
    label: "Running",
  },
  complete: {
    border: "border-[var(--border)]",
    bg: "bg-[var(--bg-primary)]",
    dot: "bg-[var(--success)]",
    text: "text-[var(--success)]",
    label: "Complete",
  },
  success: {
    border: "border-[var(--border)]",
    bg: "bg-[var(--bg-primary)]",
    dot: "bg-[var(--success)]",
    text: "text-[var(--success)]",
    label: "Complete",
  },
  error: {
    border: "border-[var(--border)]",
    bg: "bg-[var(--bg-primary)]",
    dot: "bg-[var(--error)]",
    text: "text-[var(--error)]",
    label: "Error",
  },
} as const;

export type ToolStatus = keyof typeof STATUS_STYLES;

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
