/**
 * Agent event → AG-UI mapping + fan-out for POST /api/chat.
 *
 * agent-ts streams its wire events on /runs/:id/events; every event is
 * mapped to the deck's canonical AG-UI shape here, then persisted to the
 * events table and republished on the in-process hub so non-response
 * consumers (approvals card, debug pane, other SSE subscribers) see the
 * same stream the requesting client does.
 *
 * `mapAgentEvent` is the pure mapping (exported for tests);
 * `mapAndPublishEvent` adds the saveEvent + hub.publish side effects.
 */

import { hub } from "@/lib/agui/hub";
import { raiseWarning } from "@/lib/agui/warn";
import { saveEvent } from "@/lib/agui/db";
import {
  createEvent,
  generateId,
  type RunFinished,
  type TextMessageStart,
  type TextMessageContent,
  type TextMessageEnd,
  type RunError,
  type LLMResolved,
  type ToolCallStart,
  type ToolCallArgs,
  type ToolCallResult,
  type InterruptRequested,
  type InterruptResolved,
  type ArtifactCreated,
  type AGUIEvent,
} from "@/lib/agui/events";
import { jsonPayload, isDeckPayload, type DeckPayload } from "@/lib/agui/payload";

export interface AgentGOEvent {
  type: string;
  threadId?: string;
  runId?: string;
  timestamp?: string;
  messageId?: string;
  role?: string;
  delta?: string;
  toolCallId?: string;
  toolName?: string;
  args?: { format: string; data: unknown };
  result?: { format: string; data: unknown };
  success?: boolean;
  durationMs?: number;
  error?: { message: string };
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  // Interrupt events
  approved?: boolean;
  reason?: string;
  data?: {
    kind?: string;
    approvalId?: string;
    toolCallId?: string;
    toolName?: string;
    riskLevel?: string;
    args?: unknown;
    decision?: string;
    reason?: string;
  };
  // Artifact events
  artifactId?: string;
  url?: string;
  name?: string;
  mimeType?: string;
  [key: string]: unknown;
}

/**
 * Per-stream mapping state. `sawFirstTextStart` tells us whether to
 * suppress the first TextMessageStart from agent-ts (the deck pre-emitted
 * one locally) vs forwarding the ones that begin each model turn after a
 * tool-call round.
 */
export interface EventMapState {
  sawFirstTextStart: boolean;
}

/**
 * Coerce an upstream args/result field — DeckPayload passthrough, legacy
 * `{format, data}` envelope, or a raw value — into a DeckPayload.
 */
function coercePayloadField(value: unknown): DeckPayload | undefined {
  if (value && isDeckPayload(value)) {
    return value;
  }
  const env = value as { format: string; data: unknown } | undefined;
  if (env?.data !== undefined) {
    return jsonPayload(env.data);
  }
  if (value !== undefined) {
    return jsonPayload(value);
  }
  return undefined;
}

/**
 * Parse SSE data from an agent-ts event stream. Malformed frames are
 * skipped — never crash the stream consumer on upstream drift.
 */
export function parseAgentEvent(data: string): AgentGOEvent | null {
  try {
    return JSON.parse(data);
  } catch {
    console.warn("[Chat] Failed to parse SSE data:", data);
    return null;
  }
}

/**
 * Map an agent-ts event to its AG-UI counterpart. Returns null for events
 * the deck deliberately does not forward (RunStarted — already emitted
 * locally; the first TextMessageStart — duplicate of the local pre-emit).
 * Pure: no persistence, no hub traffic.
 */
export function mapAgentEvent(
  event: AgentGOEvent,
  threadId: string,
  runId: string,
  messageId: string,
  state: EventMapState
): AGUIEvent | null {
  switch (event.type) {
    case "RunStarted":
      // Already emitted locally
      return null;

    case "RunFinished":
      return createEvent<RunFinished>("RunFinished", threadId, {
        runId,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        costUsd: event.costUsd,
      });

    case "LLMResolved":
      // Model-attribution event — the ledger keeps which provider/model
      // actually served the run (agent-ts emits it right after RunStarted).
      return createEvent<LLMResolved>("LLMResolved", threadId, {
        runId,
        provider: (event.provider as string) ?? "unknown",
        modelId: (event.modelId as string) ?? "unknown",
        label: event.label as string | undefined,
        local: event.local as boolean | undefined,
        resolveMs: event.resolveMs as number | undefined,
      });

    case "RunError":
      return createEvent<RunError>("RunError", threadId, {
        runId,
        error: event.error ?? { message: "Unknown error" },
      });

    case "TextMessageStart":
      // The deck pre-emits a TextMessageStart locally so the UI has a
      // streaming segment ready before agent-ts connects. agent-ts then
      // emits its own start for every model turn — drop the first one
      // (duplicate of our local), but forward subsequent starts so the
      // UI opens a new streaming segment after each tool-call round.
      if (!state.sawFirstTextStart) {
        state.sawFirstTextStart = true;
        return null;
      }
      return createEvent<TextMessageStart>("TextMessageStart", threadId, {
        runId,
        messageId: event.messageId ?? messageId,
        role: "assistant",
      });

    case "TextMessageContent":
      return createEvent<TextMessageContent>("TextMessageContent", threadId, {
        runId,
        messageId: event.messageId ?? messageId,
        delta: event.delta ?? "",
      });

    case "TextMessageEnd":
      return createEvent<TextMessageEnd>("TextMessageEnd", threadId, {
        runId,
        messageId: event.messageId ?? messageId,
      });

    case "ToolCallStart": {
      const start = createEvent<ToolCallStart>("ToolCallStart", threadId, {
        runId,
        toolCallId: event.toolCallId ?? generateId(),
        toolName: event.toolName ?? "unknown",
      });
      // agent-ts attaches the call's arguments to ToolCallStart
      // (loop.ts tool_execution_start). The AG-UI ToolCallStart type has
      // no args field, but the ledger stores the whole event JSON and the
      // wire tolerates extra keys — persist them under `args` so the T17
      // replay feed (agent-run.ts) can rebuild real tool_calls arguments.
      // Runs persisted before this change simply have no args; replay
      // tolerates that (arguments omitted).
      const args = coercePayloadField(event.args);
      if (args !== undefined) {
        (start as ToolCallStart & { args?: DeckPayload }).args = args;
      }
      return start;
    }

    case "ToolCallArgs":
      return createEvent<ToolCallArgs>("ToolCallArgs", threadId, {
        runId,
        toolCallId: event.toolCallId ?? generateId(),
        delta: "",
        args: coercePayloadField(event.args),
      });

    case "ToolCallResult":
      return createEvent<ToolCallResult>("ToolCallResult", threadId, {
        runId,
        toolCallId: event.toolCallId ?? generateId(),
        result: coercePayloadField(event.result) ?? jsonPayload({}),
        success: event.success,
        durationMs: event.durationMs,
      });

    case "InterruptRequested":
      // Publish interrupt request to hub for UI to handle
      return createEvent<InterruptRequested>("InterruptRequested", threadId, {
        runId,
        toolCallId: event.data?.toolCallId ?? event.toolCallId ?? generateId(),
        toolName: event.data?.toolName ?? event.toolName ?? "unknown",
        args: event.data?.args !== undefined
          ? jsonPayload(event.data.args)
          : event.args
            ? jsonPayload(event.args.data ?? event.args)
            : undefined,
      });

    case "InterruptResolved":
      return createEvent<InterruptResolved>("InterruptResolved", threadId, {
        runId,
        toolCallId: event.data?.toolCallId ?? event.toolCallId,
        approved: event.data?.decision ? event.data.decision === "approved" : event.approved ?? false,
        reason: event.data?.reason ?? event.reason,
      });

    case "ArtifactCreated": {
      const artifactId = event.artifactId ?? generateId();
      // Artifact rows are inserted upstream (lib/tools/executor.ts via
      // createArtifact, apps/agent-ts loop.ts via the bridge response)
      // already keyed to the canonical AG-UI runId. The legacy
      // relinkArtifactRun() reconciliation is no longer needed.
      return createEvent<ArtifactCreated>("ArtifactCreated", threadId, {
        runId,
        toolCallId: event.toolCallId,
        artifactId,
        url: event.url ?? "",
        name: event.name ?? "artifact",
        mimeType: event.mimeType ?? "application/octet-stream",
      });
    }

    default:
      // Upstream emitted an event type this mapping doesn't know — the
      // event is silently dropped from the client stream, so surface the
      // drift through the sanctioned warning channel instead of a raw log.
      raiseWarning({
        source: "chat.event-map",
        message: `unknown agent-ts event type dropped: ${event.type}`,
        threadId,
        runId,
        data: { type: event.type },
      });
      return null;
  }
}

/**
 * Map an agent-ts event, then persist + republish the result. Returns the
 * AG-UI event so the caller can also write it to the response stream.
 */
export function mapAndPublishEvent(
  event: AgentGOEvent,
  threadId: string,
  runId: string,
  messageId: string,
  state: EventMapState
): AGUIEvent | null {
  const aguiEvent = mapAgentEvent(event, threadId, runId, messageId, state);
  if (aguiEvent) {
    persistAndPublish(aguiEvent);
  }
  return aguiEvent;
}

/** Persist an event to the ledger and fan it out on the hub. */
export function persistAndPublish(event: AGUIEvent): void {
  saveEvent(event);
  hub.publish(event.threadId, event);
}
