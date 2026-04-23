/**
 * Shared types for the Hardware pane split.
 */

export type HardwareTabId = "overview" | "models" | "processes" | "providers" | "disk";

export const HARDWARE_TABS: ReadonlyArray<{
  id: HardwareTabId;
  label: string;
  hint: string;
}> = [
  { id: "overview", label: "Overview", hint: "KPIs + system profile + services" },
  { id: "models", label: "Models", hint: "Installed + loaded across providers" },
  { id: "processes", label: "Processes", hint: "Per-process GPU VRAM" },
  { id: "providers", label: "Providers", hint: "Adapters + discovery sweep" },
  { id: "disk", label: "Disk", hint: "Offline manifest scanner" },
];

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  const diffMs = t - Date.now();
  const abs = Math.abs(diffMs);
  if (abs < 60_000) return "in <1m";
  const mins = Math.round(abs / 60_000);
  if (mins < 60) return diffMs < 0 ? `${mins}m ago` : `in ${mins}m`;
  const hrs = Math.round(mins / 60);
  return diffMs < 0 ? `${hrs}h ago` : `in ${hrs}h`;
}
