/**
 * Loop runner — bridges pi-agent-core's `Agent` into our wire layer.
 *
 * Translates `AgentEvent` → AG-UI events 1:1:
 *   message_start / message_update / message_end → TextMessage*
 *   tool_execution_start / _end → ToolCallStart / ToolCallResult
 *   agent_start / agent_end → RunStarted / RunFinished
 *
 * Errors emit RunError. Aborts emit RunError with message="aborted".
 */

import { Agent, type AgentEvent, type BeforeToolCallContext } from "@mariozechner/pi-agent-core";
import { streamSimple, type AssistantMessageEvent, type Message } from "@mariozechner/pi-ai";
import type { ApprovalBroker, RiskLevel } from "./broker.js";
import type { EventBus } from "./event-bus.js";
import type { LoopRunner, RunHandle } from "./runs.js";
import type { AGUIEvent, AGUIEventType, ChatMessageWire } from "../wire.js";
import { nowRFC3339 } from "../wire.js";
import { resolveLLM } from "./llm.js";
import { WorkspaceJail } from "../tools/jail.js";
import { nativeTools } from "../tools/native.js";
import { bridgeTools } from "../tools/bridge.js";
import { readBootstrap } from "../context/bootstrap.js";
import { skillsTools } from "../context/skills.js";
import { domainSkillsTools } from "../context/domain-skills.js";

export interface LoopDeps {
  bus: EventBus;
  broker: ApprovalBroker;
}

/**
 * Tools whose effects are hard to roll back. Mirror of the side-effect set
 * in `lib/approvals/gate.ts` plus the local workspace mutators we add here.
 */
const SIDE_EFFECT_TOOLS = new Set<string>([
  "bash",
  "write_file",
  "edit_file",
  "execute_code",
  "live.play",
  "live.set_track",
  "live.apply_script",
  "live.fx",
  "live.load_sample",
  "live.generate_sample",
  "live.bpm",
  "vector_ingest",
  "vector_store",
  "native_click",
  "native_type",
  "native_key",
  "native_screen_grab",
  "native_focus_window",
  "native_click_pixel",
  "native_focus",
]);

const HIGH_RISK_TOOLS = new Set<string>(["bash", "execute_code"]);

function approvalPolicy(toolName: string): {
  required: boolean;
  riskLevel: RiskLevel;
} {
  const required = SIDE_EFFECT_TOOLS.has(toolName);
  const riskLevel: RiskLevel = HIGH_RISK_TOOLS.has(toolName) ? "high" : "medium";
  return { required, riskLevel };
}

const SYSTEM_PROMPT =
  process.env.AGENT_TS_SYSTEM_PROMPT ??
  "You are a helpful assistant running inside the Control Deck cockpit. Be concise and tool-aware.";

export function makeLoopRunner(deps: LoopDeps): LoopRunner {
  return async (handle, req, signal) => {
    const emit = (type: AGUIEventType, fields: Record<string, unknown> = {}) => {
      const ev: AGUIEvent = {
        threadId: handle.threadId,
        runId: handle.runId,
        timestamp: nowRFC3339(),
        schemaVersion: 2,
        type,
        ...fields,
      };
      deps.bus.emit(handle.runId, ev);
    };

    const llm = resolveLLM(req.llm);

    emit("RunStarted", {
      model: llm.modelId,
      input: {
        format: "json",
        data: req.messages?.[req.messages.length - 1]?.content ?? req.query ?? "",
      },
    });

    const messages = wireToPiMessages(req.messages, req.query, llm.model);

    const workspaceRoot = req.workspace_root ?? process.cwd();
    const jail = new WorkspaceJail(workspaceRoot);
    const tools = [
      ...nativeTools(jail),
      ...skillsTools(jail),
      ...domainSkillsTools(jail),
      ...(req.tool_bridge_url
        ? bridgeTools({
            bridgeUrl: req.tool_bridge_url,
            threadId: handle.threadId,
            runId: handle.runId,
          })
        : []),
    ];

    const bootstrap = await readBootstrap(jail);
    const systemPrompt = bootstrap.prefix
      ? `${SYSTEM_PROMPT}\n\n${bootstrap.prefix}`
      : SYSTEM_PROMPT;

    const beforeToolCall = makeBeforeToolCall({
      broker: deps.broker,
      bus: deps.bus,
      handle,
    });

    const agent = new Agent({
      initialState: {
        systemPrompt,
        model: llm.model,
        thinkingLevel: "off",
        tools,
        messages,
      },
      streamFn: streamSimple,
      getApiKey: () => llm.apiKey,
      beforeToolCall,
    });

    const messageStarted = new Set<string>();
    const unsubscribe = agent.subscribe((event) => translate(event, emit, messageStarted));

    let errorMessage: string | undefined;
    try {
      await agent.continue();
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
    } finally {
      unsubscribe();
    }

    if (signal.aborted) {
      emit("RunError", { error: { message: "aborted" } });
      deps.bus.setStatus(handle.runId, "failed");
      deps.bus.close(handle.runId);
      return;
    }

    if (errorMessage) {
      emit("RunError", { error: { message: errorMessage } });
      deps.bus.setStatus(handle.runId, "failed");
    } else {
      emit("RunFinished");
      deps.bus.setStatus(handle.runId, "completed");
    }
    deps.bus.close(handle.runId);
  };
}

function translate(
  event: AgentEvent,
  emit: (type: AGUIEventType, fields?: Record<string, unknown>) => void,
  messageStarted: Set<string>,
) {
  switch (event.type) {
    case "message_start": {
      const id = messageId(event.message);
      messageStarted.add(id);
      emit("TextMessageStart", { messageId: id, role: roleFor(event.message.role) });
      return;
    }
    case "message_update": {
      const id = messageId(event.message);
      const delta = extractDelta(event.assistantMessageEvent);
      if (delta) emit("TextMessageContent", { messageId: id, delta });
      return;
    }
    case "message_end": {
      const id = messageId(event.message);
      if (messageStarted.delete(id)) emit("TextMessageEnd", { messageId: id });
      return;
    }
    case "tool_execution_start":
      emit("ToolCallStart", {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: { format: "json", data: event.args },
      });
      return;
    case "tool_execution_end":
      emit("ToolCallResult", {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        success: !event.isError,
        result: { format: "json", data: event.result },
      });
      emitArtifacts(event, emit);
      return;
    default:
      return;
  }
}

/**
 * Block at a step boundary while the run is paused. Polls the in-memory
 * handle status — pause/resume both flip it. Returns 'aborted' if the
 * abort signal fires before resume.
 */
async function waitWhilePaused(
  handle: RunHandle,
  bus: EventBus,
  signal?: AbortSignal,
): Promise<"running" | "aborted"> {
  if (handle.status !== "paused_requested" && handle.status !== "paused") {
    return "running";
  }

  // Transition paused_requested → paused, advertise on the bus.
  if (handle.status === "paused_requested") {
    handle.status = "paused";
    bus.setStatus(handle.runId, "paused");
  }

  while (handle.status === "paused") {
    if (signal?.aborted) return "aborted";
    await new Promise((r) => setTimeout(r, 200));
  }

  bus.setStatus(handle.runId, "running");
  return "running";
}

function makeBeforeToolCall(args: {
  broker: ApprovalBroker;
  bus: EventBus;
  handle: RunHandle;
}) {
  const { broker, bus, handle } = args;
  const { runId, threadId } = handle;
  return async (
    ctx: BeforeToolCallContext,
    signal?: AbortSignal,
  ): Promise<{ block: boolean; reason?: string } | undefined> => {
    // Pause gate first — if the user requested pause via /runs/:id/pause,
    // hold here at the next step boundary until /resume or /cancel.
    const paused = await waitWhilePaused(handle, bus, signal);
    if (paused === "aborted") {
      return { block: true, reason: "run aborted while paused" };
    }

    const toolName = ctx.toolCall.name;
    const policy = approvalPolicy(toolName);
    if (!policy.required) return undefined;

    const baseEvent = {
      threadId,
      runId,
      timestamp: nowRFC3339(),
      schemaVersion: 2 as const,
    };

    const { requestId, promise } = broker.create({
      runId,
      toolName,
      toolCallId: ctx.toolCall.id,
      args: ctx.args,
      description: `Approval required for ${toolName}`,
      riskLevel: policy.riskLevel,
      signal,
    });

    bus.emit(runId, {
      ...baseEvent,
      type: "InterruptRequested",
      data: {
        kind: "approval",
        approvalId: requestId,
        toolCallId: ctx.toolCall.id,
        toolName,
        riskLevel: policy.riskLevel,
        args: ctx.args,
      },
    });

    let outcome: { approved: boolean; reason?: string };
    try {
      outcome = await promise;
    } catch (err) {
      const reason = err instanceof Error ? err.message : "approval aborted";
      bus.emit(runId, {
        ...baseEvent,
        timestamp: nowRFC3339(),
        type: "InterruptResolved",
        data: { kind: "approval", approvalId: requestId, decision: "denied", reason },
      });
      return { block: true, reason };
    }

    bus.emit(runId, {
      ...baseEvent,
      timestamp: nowRFC3339(),
      type: "InterruptResolved",
      data: {
        kind: "approval",
        approvalId: requestId,
        decision: outcome.approved ? "approved" : "denied",
        reason: outcome.reason,
      },
    });

    if (outcome.approved) return undefined;
    return {
      block: true,
      reason: outcome.reason ?? `${toolName} was denied by user`,
    };
  };
}

interface BridgeArtifact {
  id: string;
  url: string;
  name: string;
  mimeType: string;
}

function emitArtifacts(
  event: Extract<AgentEvent, { type: "tool_execution_end" }>,
  emit: (type: AGUIEventType, fields?: Record<string, unknown>) => void,
) {
  const result = event.result as { details?: { artifacts?: BridgeArtifact[] } } | undefined;
  const artifacts = result?.details?.artifacts;
  if (!artifacts?.length) return;
  for (const art of artifacts) {
    emit("ArtifactCreated", {
      toolCallId: event.toolCallId,
      artifactId: art.id,
      url: art.url,
      name: art.name,
      mimeType: art.mimeType,
    });
  }
}

function messageId(message: { timestamp?: number; role: string }): string {
  return `${message.role}-${message.timestamp ?? Date.now()}`;
}

function roleFor(role: string): "user" | "assistant" | "system" {
  if (role === "user") return "user";
  if (role === "assistant") return "assistant";
  return "system";
}

function extractDelta(ev: AssistantMessageEvent): string | null {
  if (ev.type === "text_delta" && typeof ev.delta === "string") return ev.delta;
  return null;
}

export const __testHooks = {
  makeBeforeToolCall,
  waitWhilePaused,
};

function wireToPiMessages(
  wire: ChatMessageWire[] | undefined,
  legacyQuery: string | undefined,
  model: { api: string; provider: string; id: string },
): Message[] {
  const out: Message[] = [];
  const list = wire?.length ? wire : legacyQuery ? [{ role: "user", content: legacyQuery }] : [];
  for (const m of list) {
    if (m.role === "user") {
      out.push({
        role: "user",
        content: m.content,
        timestamp: Date.now(),
      });
    } else if (m.role === "assistant") {
      out.push({
        role: "assistant",
        content: [{ type: "text", text: m.content }],
        api: model.api as never,
        provider: model.provider as never,
        model: model.id,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.now(),
      });
    }
    // system / tool messages are skipped; pi-agent-core uses initialState.systemPrompt
  }
  return out;
}
