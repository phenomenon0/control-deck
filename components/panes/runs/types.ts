/**
 * Shared types for the Runs pane decomposition.
 *
 * These mirror what the /api/agui/runs endpoint returns. Keep in sync with
 * lib/agui/db.ts → RunRow when new columns land.
 */

import type { DeckPayload } from "@/lib/agui/payload";

export type ViewMode = "list" | "glyph" | "metrics" | "approvals";

export interface Run {
  id: string;
  thread_id: string;
  started_at: string;
  ended_at: string | null;
  status: "running" | "finished" | "error";
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  preview: string | null;
}

export interface TodayCost {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface RunEvent {
  id: string;
  type: string;
  timestamp: string;
  threadId: string;
  runId: string;
  toolCallId?: string;
  toolName?: string;
  args?: DeckPayload;
  result?: DeckPayload;
  success?: boolean;
  durationMs?: number;
  delta?: string;
  error?: { message: string };
  [key: string]: unknown;
}

export interface ToolCall {
  id: string;
  name: string;
  startedAt: string;
  endedAt?: string;
  status: "running" | "complete" | "error";
  args?: DeckPayload;
  result?: DeckPayload;
  success?: boolean;
}

export interface GlyphItem {
  runId: string;
  toolName: string;
  payload: DeckPayload;
  type: "args" | "result";
  timestamp: string;
}

export interface GlyphEvalResults {
  passed: number;
  failed: number;
  total: number;
  glyphSize: number;
  savings: number;
  results: Array<{ question: string; expected: string; answer: string; passed: boolean }>;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString();
}

export function formatDuration(start: string, end: string | null): string {
  if (!end) return "...";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
