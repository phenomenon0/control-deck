/**
 * Chat API Route — agent-ts (pi-agent-core) backend.
 *
 * Proxies chat requests to the agent-ts runtime on :4244 which handles:
 * - LLM orchestration with tool loop (pi-mono)
 * - Native tools (workspace, web_search, memory)
 * - Tool bridge for UI tools (image gen, etc.)
 *
 * One runtime, no fallback. If pi-mono is unreachable we surface the
 * error to the user instead of silently switching to a tool-less path.
 *
 * Returns a single SSE event stream; also republishes AG-UI events to local hub.
 *
 * This file is the thin orchestrator; the work lives in ./_lib:
 *   validate.ts    — request-shape checks (fail fast, no side effects)
 *   prompt.ts      — system-prompt assembly (skills + memory + workflow + voice)
 *   model-route.ts — "which LLM?" resolution + fallback chain
 *   agent-run.ts   — agent-ts /runs client + wire-request build
 *   proxy.ts       — agent-ts event-stream consumption (background loop)
 *   publish.ts     — agent event → AG-UI mapping, persistence + hub fan-out
 *   stream.ts      — SSE response plumbing (heartbeat, abort, headers)
 */

import { createEvent, generateId, type RunStarted, type TextMessageStart } from "@/lib/agui/events";
import { jsonPayload } from "@/lib/agui/payload";
import { createRun, createThread, finishRun, errorRun } from "@/lib/agui/db";
import { augmentForModel } from "@/lib/llm/systemPrompt";
import { type LocalPreset } from "@/lib/inference/local-defaults";
import { buildToolBridgeUrl, buildMcpToolsUrl } from "@/lib/tools/bridge-url";
import {
  type ChatRequestBody,
  jsonError,
  normalizeClientMessages,
  RUN_ID_PATTERN,
  VALID_PRESETS,
} from "./_lib/validate";
import { assembleSystemPrompt } from "./_lib/prompt";
import { resolveChatModel } from "./_lib/model-route";
import { buildAgentMessages, buildStartRunRequest, buildToolReplayBlocks, mergeReplayBlocks } from "./_lib/agent-run";
import { proxyAgentRun } from "./_lib/proxy";
import { persistAndPublish } from "./_lib/publish";
import { ChatSSEStream, createSSEResponse } from "./_lib/stream";

export async function POST(req: Request) {
  // Parse and validate request body
  let body: ChatRequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body");
  }

  const {
    messages,
    model,
    providerId,
    threadId,
    runId: clientRunId,
    systemPrompt: clientPrompt,
    preset: presetRaw,
    voice,
  } = body;

  const normalized = normalizeClientMessages(messages);
  if (!normalized.ok) return normalized.response;
  const chatMessages = normalized.messages;

  const requestedRunId = clientRunId ?? voice?.runId;
  if (requestedRunId !== undefined && !RUN_ID_PATTERN.test(requestedRunId)) {
    return jsonError("runId must be 1-128 chars using letters, numbers, _, ., -, or :");
  }

  const preset: LocalPreset =
    presetRaw && VALID_PRESETS.has(presetRaw) ? presetRaw : "balanced";

  // Ensure the thread row exists before anything else reads from it.
  // INSERT OR IGNORE — no-op if already present. Closes a latent race
  // where /api/chat was previously assuming the client pre-created via
  // /api/threads, which silently made getThread() return undefined and
  // per-thread overrides impossible.
  if (threadId) createThread(threadId);

  const systemPrompt = assembleSystemPrompt({
    threadId,
    clientPrompt,
    voice,
    messages: chatMessages,
  });

  const { route, selectedModel } = await resolveChatModel({
    model,
    providerId,
    preset,
    messages: chatMessages,
  });

  const thread = threadId ?? generateId();
  // Honour a client-supplied runId so the voice surface can target a
  // specific run for cancel before the server has a chance to round-trip
  // its own id back. agent-ts already accepts the same id we generate
  // here, so the whole chain shares one runId.
  const runId = requestedRunId ?? generateId();
  const messageId = generateId();

  // Emit local RunStarted (for immediate UI feedback)
  const lastMessage = chatMessages[chatMessages.length - 1]?.content;
  const runStarted = createEvent<RunStarted>("RunStarted", thread, {
    runId,
    model: selectedModel,
    input: lastMessage ? jsonPayload(lastMessage) : undefined,
  });
  createRun(runId, thread, selectedModel);
  persistAndPublish(runStarted);

  // Emit TextMessageStart locally
  const msgStart = createEvent<TextMessageStart>("TextMessageStart", thread, {
    runId,
    messageId,
    role: "assistant",
  });
  persistAndPublish(msgStart);

  const baseMessages = buildAgentMessages(chatMessages);
  // T17 replay feed: agent-ts's wireToPiMessages replays assistant
  // tool_calls + tool results when the wire history carries them, but the
  // client only sends user/assistant text — so prior tool exchanges were
  // invisible to the model. Rebuild them from the events ledger (bounded;
  // see _lib/agent-run.ts). Skipped for minted threads: no prior runs.
  const agentMessages = mergeReplayBlocks(
    baseMessages,
    threadId ? buildToolReplayBlocks(thread, runId) : [],
  );

  // The assembled system prompt travels as the dedicated `system_prompt`
  // wire field — agent-ts installs it as the run's actual system prompt.
  // Per-model family nudges (language anchor, reasoning focus) are part of
  // assembly, so they still apply here. We deliberately do NOT prepend a
  // role:"system" chat message: agent-ts drops non-user/assistant roles
  // from history, which used to silently discard this entire prompt.
  const assembledSystemPrompt = augmentForModel(systemPrompt ?? "", selectedModel).trim();

  const agentRequest = buildStartRunRequest({
    messages: agentMessages,
    threadId: thread,
    runId,
    assembledSystemPrompt,
    route,
    selectedModel,
    toolBridgeUrl: buildToolBridgeUrl(req),
    mcpUrl: buildMcpToolsUrl(req),
  });

  const stream = new ChatSSEStream(req.signal);

  // Background proxy — kicked, not awaited: the Response below is returned
  // immediately and the loop writes into it until the run terminates.
  void proxyAgentRun({
    agentRequest,
    signal: req.signal,
    threadId: thread,
    runId,
    messageId,
    prelude: { runStarted, msgStart },
    stream,
  });

  return createSSEResponse(stream, { threadId: thread, runId, messageId });
}

/**
 * Direct tool execution endpoint (for manual triggers)
 * PUT /api/chat - Execute a tool directly without LLM
 *
 * This remains unchanged - uses local executor
 */
export async function PUT(req: Request) {
  // Dynamic import keeps the shared bridge dispatcher out of the chat
  // route's initial bundle (and with it executor, approvals, zod schemas).
  const { bridgeDispatch } = await import("@/lib/tools/bridgeDispatch");

  let body: { tool?: string; args?: Record<string, unknown>; threadId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { tool, args, threadId } = body;
  const thread = threadId ?? generateId();
  const runId = generateId();
  const toolCallId = generateId();

  createRun(runId, thread, "tool:" + (tool ?? "unknown"));

  const outcome = await bridgeDispatch({
    tool: tool ?? "",
    args: (args ?? {}) as Record<string, unknown>,
    threadId: thread,
    runId,
    toolCallId,
  });

  switch (outcome.kind) {
    case "bad_request":
      errorRun(runId, outcome.message);
      return Response.json(
        { success: false, error: outcome.message, runId, threadId: thread },
        { status: 400 },
      );
    case "denied":
      errorRun(runId, outcome.reason);
      return Response.json(
        { success: false, error: `tool call denied: ${outcome.reason}`, runId, threadId: thread },
        { status: 403 },
      );
    case "error":
      errorRun(runId, outcome.message);
      return Response.json(
        { success: false, error: outcome.message, runId, threadId: thread },
        { status: 500 },
      );
    case "ok": {
      finishRun(runId, 0, 0, 0);
      const r = outcome.result;
      return Response.json({
        success: r.success,
        message: r.message,
        artifacts: r.artifacts,
        runId,
        threadId: thread,
      });
    }
  }
}
