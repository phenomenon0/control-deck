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
import type { ModelRoute } from "@/lib/engine/resolve";
// Agent runtime: agent-ts (apps/agent-ts) on :4244. pi-agent-core wrapped
// in the AG-UI/SSE wire contract. URL resolution lives in
// `lib/agentgo/launcher.ts` so launch + chat + approve/reject stay aligned.
import { AGENTGO_URL, withAgentTsAuth } from "@/lib/agentgo/launcher";
import type { ClientMessage } from "./validate";

export interface AgentGOMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
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
