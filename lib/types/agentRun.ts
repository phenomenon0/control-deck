import type { Artifact } from "@/lib/types/chat";

export type RunPhase =
  | "idle"
  | "submitted"
  | "thinking"
  | "streaming"
  | "executing"
  | "resuming"
  | "error";

export type RunState =
  | { phase: "idle" }
  | { phase: "submitted"; startedAt: number }
  | { phase: "thinking"; runId: string; startedAt: number }
  | { phase: "streaming"; runId: string; messageId: string; startedAt: number }
  | { phase: "executing"; runId: string; toolCallId: string; toolName: string; startedAt: number }
  | { phase: "resuming"; runId: string; startedAt: number }
  | { phase: "error"; runId?: string; error: string };

export interface ActivityStep {
  toolCallId: string;
  toolName: string;
  args?: Record<string, unknown>;
  status: "running" | "complete" | "error";
  result?: {
    success: boolean;
    message?: string;
    error?: string;
    data?: Record<string, unknown>;
  };
  durationMs?: number;
  startedAt: number;
}

interface SegmentBase {
  id: string;
  timestamp: number;
}

export interface UserMessageSegment extends SegmentBase {
  type: "user-message";
  content: string;
  uploads?: { id: string; name: string; url?: string }[];
}

export interface AgentReasoningSegment extends SegmentBase {
  type: "agent-reasoning";
  content: string;
  isStreaming: boolean;
}

export interface AgentActivitySegment extends SegmentBase {
  type: "agent-activity";
  steps: ActivityStep[];
}

export interface AgentMessageSegment extends SegmentBase {
  type: "agent-message";
  messageId: string;
  content: string;
  isStreaming: boolean;
  complete?: boolean;
  stopped?: boolean;
}

export interface ErrorSegment extends SegmentBase {
  type: "error";
  error: string;
  retryable: boolean;
}

export interface ArtifactSegment extends SegmentBase {
  type: "artifact";
  artifact: Artifact;
  toolCallId?: string;
}

export type TimelineSegment =
  | UserMessageSegment
  | AgentReasoningSegment
  | AgentActivitySegment
  | AgentMessageSegment
  | ArtifactSegment
  | ErrorSegment;

export type TimelineSegmentType = TimelineSegment["type"];

export type RunAction =
  | { type: "SUBMIT"; content: string; uploads?: UserMessageSegment["uploads"] }
  | { type: "RUN_STARTED"; runId: string; thinking?: boolean; model?: string }
  | { type: "RUN_FINISHED"; runId: string; threadTitle?: string }
  | { type: "RUN_ERROR"; runId: string; error: string }
  | { type: "REASONING_START" }
  | { type: "REASONING_DELTA"; delta: string }
  | { type: "REASONING_END" }
  | { type: "TEXT_START"; messageId: string }
  | { type: "TEXT_DELTA"; delta: string }
  | { type: "TEXT_END" }
  | { type: "TOOL_START"; toolCallId: string; toolName: string }
  | { type: "TOOL_ARGS"; toolCallId: string; args: Record<string, unknown> }
  | { type: "TOOL_RESULT"; toolCallId: string; result: ActivityStep["result"]; durationMs?: number }
  | { type: "ARTIFACT_CREATED"; artifact: Artifact; toolCallId?: string }
  | { type: "LOAD_HISTORY"; segments: TimelineSegment[] }
  | { type: "STOP" };

export interface AgentRunState {
  runState: RunState;
  segments: TimelineSegment[];
  threadTitle?: string;
  /**
   * Model id carried on `RunStarted` from the server. Source of truth
   * for "what actually answered this turn" — the composer's requested
   * model can differ (free-mode substitution, resolver snap, etc).
   * Reset to null on SUBMIT.
   */
  resolvedModel: string | null;
}

export const INITIAL_AGENT_RUN_STATE: AgentRunState = {
  runState: { phase: "idle" },
  segments: [],
  resolvedModel: null,
};
