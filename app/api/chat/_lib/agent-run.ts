/**
 * agent-ts run client for POST /api/chat.
 *
 * Builds the pinned wire request (message sanitisation, system_prompt,
 * resolved LLM config, bridge URLs) and starts the run on agent-ts.
 * One runtime, no fallback: if agent-ts is unreachable the caller surfaces
 * the error to the user instead of silently switching to a tool-less path.
 *
 * The SSE consumption half of the gateway lives in ./proxy.ts.
 */

import { raiseWarning } from "@/lib/agui/warn";
import { stripForLLMHistory } from "@/lib/chat/stripPatterns";
import { retryingFetch } from "@/lib/agentgo/client";
import { getEvents, getRuns } from "@/lib/agui/db";
import type {
  AGUIEvent,
  ToolCallArgs,
  ToolCallResult,
  ToolCallStart,
} from "@/lib/agui/events";
import { tryDecodePayload, type DeckPayload } from "@/lib/agui/payload";
import type { ModelRoute } from "@/lib/engine/resolve";
// Agent runtime: agent-ts (apps/agent-ts) on :4244. pi-agent-core wrapped
// in the AG-UI/SSE wire contract. URL resolution lives in
// `lib/agentgo/launcher.ts` so launch + chat + approve/reject stay aligned.
import { AGENTGO_URL, withAgentTsAuth } from "@/lib/agentgo/launcher";
import type { ClientMessage } from "./validate";

/** OpenAI-style tool call on an assistant wire message (apps/agent-ts wire.ts ChatMessageWireToolCall). */
export interface AgentGOMessageToolCall {
  id: string;
  name: string;
  /** Arguments as a JSON string or an already-parsed object. */
  arguments?: unknown;
}

export interface AgentGOMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  /** Assistant role only: tool calls the model issued in that turn. */
  tool_calls?: AgentGOMessageToolCall[];
  /** tool role: id of the assistant tool call this answers. */
  tool_call_id?: string;
  /** tool role: originating tool name. */
  name?: string;
  /** tool role: true when the result is an error. */
  is_error?: boolean;
}

export interface AgentGOStartRunRequest {
  messages: AgentGOMessage[];
  thread_id: string;
  /**
   * Fully-assembled system prompt (memory + skill index + workflow ref +
   * thread persona + voice mode, augmented per model family). Travels as a
   * dedicated wire field — agent-ts installs it as the run's real system
   * prompt (pi-agent-core initialState.systemPrompt). Canon: Next
   * assembles, agent-ts obeys. Never injected as a role:"system" chat
   * message; agent-ts (correctly) drops those from history.
   */
  system_prompt?: string;
  /**
   * Canonical AG-UI run id. agent-ts honours it so all events downstream
   * of /runs share the same id Next created here. Replaces the legacy
   * `setAgentRunId` reconciliation step removed in the cd47211 cleanup.
   */
  run_id?: string;
  workspace_root?: string;
  mode?: string;
  max_steps?: number;
  /**
   * Pinned wire contract with agent-ts: the fully-resolved model route for
   * this run. When present, agent-ts uses it verbatim (provider is
   * informational; base_url + model + api_key drive its LLM client) and
   * fails with structured errors instead of falling back to its own
   * presets. Resolved once per request via lib/engine/resolve.
   */
  llm?: {
    provider: string;
    model: string;
    base_url: string;
    api_key: string | null;
  };
  tool_bridge_url?: string;
  mcp_url?: string;
}

/**
 * Build the wire message list from validated client messages. Assistant
 * history is stripped of fake tool-call patterns so the LLM doesn't learn
 * to fake tool calls (SURFACE.md §4.3); messages that strip down to
 * nothing get a placeholder so role alternation survives, and anything
 * still empty is dropped.
 */
export function buildAgentMessages(chatMessages: ClientMessage[]): AgentGOMessage[] {
  return chatMessages
    .map(m => {
      const rawContent = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      const content = m.role === "assistant" ? stripForLLMHistory(rawContent) : rawContent;
      return {
        role: m.role as AgentGOMessage["role"],
        content: content || "[Previous response contained only generated content]",
      };
    })
    .filter(m => m.content.trim().length > 0);
}

/* ── T17 tool-call replay feed ──────────────────────────────────────
 *
 * agent-ts's wireToPiMessages replays prior tool exchanges when the wire
 * history carries them (assistant tool_calls immediately followed by their
 * tool messages — LLM APIs reject unpaired entries). The deck's client
 * only sends user/assistant text, so everything the agent DID in earlier
 * turns was invisible to the model. This feed rebuilds the exchanges from
 * the events ledger (lib/agui/db getRuns/getEvents), which persists full
 * ToolCallStart / ToolCallArgs / ToolCallResult payloads per run.
 *
 * Bounds (kept deliberately simple):
 *   REPLAY_SCAN_RUNS        — only the 8 most recent prior runs of the
 *                             thread are scanned (newest first).
 *   REPLAY_MAX_TOOL_CALLS   — at most 12 paired exchanges make the wire,
 *                             newest runs first; a budget exhausted mid-run
 *                             keeps that run's EARLIEST exchanges.
 *   REPLAY_RESULT_MAX_CHARS — each replayed tool result is capped at 4000
 *                             chars so replay can't blow the context window.
 *
 * Known ledger gap: agent-ts attaches call arguments to ToolCallStart and
 * runs persisted before the publish.ts args fix have none — replay then
 * omits `arguments` (agent-ts substitutes {}). Never invent arguments.
 */
export const REPLAY_SCAN_RUNS = 8;
export const REPLAY_MAX_TOOL_CALLS = 12;
export const REPLAY_RESULT_MAX_CHARS = 4000;

/** One completed start→result pair, in the order the results arrived. */
export interface ToolExchange {
  id: string;
  name: string;
  /** Decoded arguments; undefined when the ledger row has none (see gap note). */
  arguments?: unknown;
  /** Flattened result text, capped at REPLAY_RESULT_MAX_CHARS. */
  content: string;
  isError: boolean;
}

/** A run's replayable wire messages plus its position among prior runs. */
export interface ReplayBlock {
  /** 0 = most recent prior run of the thread, 1 = the one before it, … */
  priorIndex: number;
  /** [assistant(tool_calls), tool, tool, …] — pairing is never broken. */
  messages: AgentGOMessage[];
}

/** Decode a persisted args DeckPayload; undefined when absent/undecodable. */
function decodeArgsPayload(payload: DeckPayload | undefined): unknown {
  if (payload === undefined) return undefined;
  return tryDecodePayload(payload) ?? undefined;
}

/** Concatenated ToolCallArgs deltas parse as one JSON document, or nothing. */
function parseArgDeltas(deltas: string[]): unknown {
  const raw = deltas.join("");
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Flatten a persisted ToolCallResult payload into wire `content` text. */
function toolResultContent(result: DeckPayload | undefined): string {
  const decoded = result === undefined ? undefined : tryDecodePayload(result);
  let text: string;
  if (decoded == null) {
    text = "";
  } else if (typeof decoded === "string") {
    text = decoded;
  } else if (
    typeof decoded === "object" &&
    Array.isArray((decoded as { content?: unknown }).content)
  ) {
    // pi tool-result shape persisted by agent-ts runs:
    // { content: [{ type: "text", text }, ...], details? }
    const blocks = (decoded as { content: Array<{ type?: string; text?: unknown }> }).content;
    text = blocks
      .filter(b => b && (b.type === undefined || b.type === "text") && typeof b.text === "string")
      .map(b => b.text as string)
      .join("\n");
  } else {
    text = JSON.stringify(decoded);
  }
  if (text.length > REPLAY_RESULT_MAX_CHARS) {
    return text.slice(0, REPLAY_RESULT_MAX_CHARS) + "…[truncated]";
  }
  return text;
}

/**
 * Pair one run's persisted ToolCallStart/Args/Result events into replayable
 * exchanges. Pairs are emitted in result-arrival order; starts without a
 * result (run errored mid-call) and results without a start are dropped —
 * LLM APIs reject unpaired tool calls, so nothing unpaired ever leaves here.
 */
export function extractToolExchanges(events: AGUIEvent[]): ToolExchange[] {
  interface PendingCall {
    name: string;
    arguments?: unknown;
    argDeltas: string[];
  }
  const pending = new Map<string, PendingCall>();
  const exchanges: ToolExchange[] = [];

  for (const event of events) {
    if (event.type === "ToolCallStart") {
      const start = event as ToolCallStart & { args?: DeckPayload };
      pending.set(start.toolCallId, {
        name: start.toolName,
        arguments: decodeArgsPayload(start.args),
        argDeltas: [],
      });
    } else if (event.type === "ToolCallArgs") {
      const argsEvent = event as ToolCallArgs;
      const call = pending.get(argsEvent.toolCallId);
      if (!call) continue;
      if (argsEvent.args !== undefined) {
        // Mapped args payloads carry the complete args; last one wins.
        call.arguments = decodeArgsPayload(argsEvent.args);
      } else if (typeof argsEvent.delta === "string" && argsEvent.delta) {
        call.argDeltas.push(argsEvent.delta);
      }
    } else if (event.type === "ToolCallResult") {
      const result = event as ToolCallResult;
      const call = pending.get(result.toolCallId);
      if (!call) continue; // result without a start — nothing to pair with
      pending.delete(result.toolCallId);
      exchanges.push({
        id: result.toolCallId,
        name: call.name,
        arguments: call.arguments ?? parseArgDeltas(call.argDeltas),
        content: toolResultContent(result.result),
        isError: result.success === false,
      });
    }
  }
  // Leftover pending calls never got a result — dropped (unpaired).
  return exchanges;
}

/** Materialize exchanges as the exact wire pair sequence agent-ts expects. */
export function exchangesToMessages(exchanges: ToolExchange[]): AgentGOMessage[] {
  if (exchanges.length === 0) return [];
  return [
    {
      role: "assistant",
      content: "",
      tool_calls: exchanges.map(x => ({
        id: x.id,
        name: x.name,
        ...(x.arguments !== undefined ? { arguments: x.arguments } : {}),
      })),
    },
    ...exchanges.map(x => ({
      role: "tool" as const,
      content: x.content,
      tool_call_id: x.id,
      name: x.name,
      is_error: x.isError,
    })),
  ];
}

/**
 * Read the events ledger and build replay blocks for the thread's recent
 * prior runs (newest first, bounded by REPLAY_SCAN_RUNS /
 * REPLAY_MAX_TOOL_CALLS). Ledger failures degrade to no replay — the chat
 * turn must never fail because history reconstruction did.
 */
export function buildToolReplayBlocks(threadId: string, excludeRunId?: string): ReplayBlock[] {
  try {
    const runs = getRuns(threadId)
      .filter(r => r.id !== excludeRunId)
      .slice(0, REPLAY_SCAN_RUNS);
    const blocks: ReplayBlock[] = [];
    let budget = REPLAY_MAX_TOOL_CALLS;
    for (let priorIndex = 0; priorIndex < runs.length && budget > 0; priorIndex++) {
      const exchanges = extractToolExchanges(getEvents(runs[priorIndex].id));
      if (exchanges.length === 0) continue;
      const kept = exchanges.slice(0, budget);
      budget -= kept.length;
      blocks.push({ priorIndex, messages: exchangesToMessages(kept) });
    }
    return blocks;
  } catch (err) {
    raiseWarning({
      source: "chat.replay",
      message: `tool replay feed failed for thread ${threadId}: ${err instanceof Error ? err.message : String(err)}`,
      threadId,
      runId: excludeRunId,
    });
    return [];
  }
}

/**
 * Weave replay blocks into the sanitized client history. Each block anchors
 * right after the user message that started its run: the LAST user message
 * belongs to the current run, so prior run #p (0 = newest) anchors to the
 * (p + 2)-th user message from the end. Blocks whose anchor was trimmed
 * from client history are parked just before the current user message —
 * still past-turn context, pairing always intact.
 */
export function mergeReplayBlocks(
  messages: AgentGOMessage[],
  blocks: ReplayBlock[]
): AgentGOMessage[] {
  if (blocks.length === 0) return messages;

  const userIdx: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === "user") userIdx.push(i);
  }
  const lastUserIdx = userIdx.length > 0 ? userIdx[userIdx.length - 1] : -1;

  const after = new Map<number, AgentGOMessage[]>();
  const orphans: AgentGOMessage[] = [];
  // Oldest run first so co-anchored/orphaned blocks stay chronological.
  const sorted = [...blocks].sort((a, b) => b.priorIndex - a.priorIndex);
  for (const block of sorted) {
    const fromEnd = block.priorIndex + 2;
    const anchor = userIdx.length >= fromEnd ? userIdx[userIdx.length - fromEnd] : -1;
    if (anchor >= 0) {
      after.set(anchor, [...(after.get(anchor) ?? []), ...block.messages]);
    } else {
      orphans.push(...block.messages);
    }
  }

  const out: AgentGOMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (i === lastUserIdx) out.push(...orphans);
    out.push(messages[i]);
    const parked = after.get(i);
    if (parked) out.push(...parked);
  }
  if (lastUserIdx === -1) out.push(...orphans);
  return out;
}

export interface BuildRunRequestInput {
  messages: AgentGOMessage[];
  threadId: string;
  runId: string;
  /** Assembled + model-augmented system prompt; empty string → omitted. */
  assembledSystemPrompt: string;
  route: ModelRoute;
  selectedModel: string;
  toolBridgeUrl: string;
  mcpUrl: string;
}

export function buildStartRunRequest(input: BuildRunRequestInput): AgentGOStartRunRequest {
  return {
    messages: input.messages,
    thread_id: input.threadId,
    system_prompt: input.assembledSystemPrompt || undefined,
    run_id: input.runId,
    workspace_root: process.env.WORKSPACE_ROOT ?? undefined,
    mode: "BUILD",
    max_steps: parseInt(process.env.AGENT_MAX_STEPS ?? "25", 10),
    llm: {
      provider: input.route.provider,
      model: input.selectedModel,
      base_url: input.route.baseUrl,
      api_key: input.route.apiKey ?? null,
    },
    tool_bridge_url: input.toolBridgeUrl,
    mcp_url: input.mcpUrl,
  };
}

/**
 * Start the run on agent-ts. retryingFetch handles network errors + 5xx
 * with exponential backoff so a brief runtime hiccup doesn't break the
 * chat turn; 4xx still fails fast. Returns the run id agent-ts echoed
 * back (expected to equal the requested runId — divergence raises a
 * warning because artifact/run linkage depends on it).
 */
export async function startAgentRun(
  agentRequest: AgentGOStartRunRequest,
  ids: { threadId: string; runId: string },
  signal?: AbortSignal
): Promise<string> {
  const startResponse = await retryingFetch(`${AGENTGO_URL}/runs`, {
    method: "POST",
    headers: withAgentTsAuth({ "Content-Type": "application/json" }),
    body: JSON.stringify(agentRequest),
    signal,
  });

  if (!startResponse.ok) {
    const errorText = await startResponse.text();
    throw new Error(`agent-ts returned ${startResponse.status}: ${errorText}`);
  }

  const startData = await startResponse.json();
  const agentRunId: string = startData.run_id;
  // Canonical-runId invariant: agent-ts must echo back the run_id we sent
  // in agentRequest. A divergence here means an agent-ts build ignored
  // req.run_id and allocated its own — the legacy reconcile path is gone,
  // so this would silently break artifact/run linkage.
  if (agentRunId && agentRunId !== ids.runId) {
    raiseWarning({
      source: "chat.run-id",
      message: `agent-ts run id divergence: deck=${ids.runId} agent=${agentRunId} — artifact/run linkage may break`,
      threadId: ids.threadId,
      runId: ids.runId,
      data: { agentRunId },
    });
  }
  return agentRunId;
}
