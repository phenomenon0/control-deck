/**
 * Chat API Route - Agent-GO Backend Integration
 * 
 * Proxies chat requests to Agent-GO server which handles:
 * - LLM orchestration with tool loop
 * - Native tools (workspace, web_search, memory)
 * - Tool bridge for UI tools (image gen, etc.)
 * 
 * Returns a single SSE event stream; also republishes AG-UI events to local hub.
 */

import { hub } from "@/lib/agui/hub";
import {
  createEvent,
  generateId,
  type RunStarted,
  type TextMessageStart,
  type TextMessageContent,
  type TextMessageEnd,
  type RunFinished,
  type RunError,
  type ToolCallStart,
  type ToolCallArgs,
  type ToolCallResult,
  type InterruptRequested,
  type InterruptResolved,
  type ArtifactCreated,
  type AGUIEvent,
} from "@/lib/agui/events";
import { jsonPayload, isDeckPayload, type DeckPayload } from "@/lib/agui/payload";
import {
  createRun,
  finishRun,
  errorRun,
  updateRunPreview,
  setAgentRunId,
  saveEvent,
  saveMessage,
  relinkArtifactRun,
  getThread,
  type MessageMetadata,
} from "@/lib/agui/db";
import { getDefaultModel, getProviderConfig } from "@/lib/llm";
import { getSystemProfile } from "@/lib/system";
import { stripForLLMHistory } from "@/lib/chat/stripPatterns";
import { retryingFetch, AgentGoUnavailableError } from "@/lib/agentgo/client";

// Agent-GO server configuration
const AGENTGO_URL = process.env.AGENTGO_URL ?? "http://localhost:4243";
const TOOL_BRIDGE_URL = process.env.TOOL_BRIDGE_URL ?? "http://localhost:3333/api/tools/bridge";

interface ChatRequestBody {
  messages?: Array<{ role: string; content: string; metadata?: MessageMetadata }>;
  model?: string;
  threadId?: string;
  uploadIds?: string[];
}

interface AgentGOMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
}

interface AgentGOStartRunRequest {
  messages: AgentGOMessage[];
  thread_id: string;
  workspace_root?: string;
  mode?: string;
  max_steps?: number;
  llm?: {
    base_url?: string;
    model?: string;
    api_key?: string;
  };
  tool_bridge_url?: string;
}

interface AgentGOEvent {
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
  // Artifact events
  artifactId?: string;
  url?: string;
  name?: string;
  mimeType?: string;
  [key: string]: unknown;
}

/**
 * Parse SSE data from Agent-GO event stream
 */
function parseSSE(data: string): AgentGOEvent | null {
  try {
    return JSON.parse(data);
  } catch {
    console.warn("[Chat] Failed to parse SSE data:", data);
    return null;
  }
}

/**
 * Map Agent-GO event to AG-UI event and publish to local hub
 */
function mapAndPublishEvent(
  event: AgentGOEvent,
  threadId: string,
  runId: string,
  messageId: string
): AGUIEvent | null {
  let aguiEvent: AGUIEvent | null = null;

  switch (event.type) {
    case "RunStarted":
      // Already emitted locally
      break;

    case "RunFinished":
      aguiEvent = createEvent<RunFinished>("RunFinished", threadId, {
        runId,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        costUsd: event.costUsd,
      });
      break;

    case "RunError":
      aguiEvent = createEvent<RunError>("RunError", threadId, {
        runId,
        error: event.error ?? { message: "Unknown error" },
      });
      break;

    case "TextMessageStart":
      // Already emitted locally
      break;

    case "TextMessageContent":
      aguiEvent = createEvent<TextMessageContent>("TextMessageContent", threadId, {
        runId,
        messageId: event.messageId ?? messageId,
        delta: event.delta ?? "",
      });
      break;

    case "TextMessageEnd":
      aguiEvent = createEvent<TextMessageEnd>("TextMessageEnd", threadId, {
        runId,
        messageId: event.messageId ?? messageId,
      });
      break;

    case "ToolCallStart":
      aguiEvent = createEvent<ToolCallStart>("ToolCallStart", threadId, {
        runId,
        toolCallId: event.toolCallId ?? generateId(),
        toolName: event.toolName ?? "unknown",
      });
      break;

    case "ToolCallArgs": {
      // Preserve payload format if already DeckPayload
      let argsPayload: DeckPayload | undefined;
      if (event.args && isDeckPayload(event.args)) {
        argsPayload = event.args;
      } else if (event.args?.data !== undefined) {
        argsPayload = jsonPayload(event.args.data);
      } else if (event.args !== undefined) {
        argsPayload = jsonPayload(event.args);
      }
      
      aguiEvent = createEvent<ToolCallArgs>("ToolCallArgs", threadId, {
        runId,
        toolCallId: event.toolCallId ?? generateId(),
        delta: "",
        args: argsPayload,
      });
      break;
    }

    case "ToolCallResult": {
      // Preserve GLYPH encoding if executor provided it as DeckPayload
      let resultPayload: DeckPayload;
      if (event.result && isDeckPayload(event.result)) {
        // Already a DeckPayload (GLYPH or JSON), use as-is
        resultPayload = event.result;
      } else if (event.result?.data !== undefined) {
        // Legacy format: { format: string, data: unknown }
        resultPayload = jsonPayload(event.result.data);
      } else if (event.result !== undefined) {
        // Raw value, wrap in JSON payload
        resultPayload = jsonPayload(event.result);
      } else {
        resultPayload = jsonPayload({});
      }
      
      aguiEvent = createEvent<ToolCallResult>("ToolCallResult", threadId, {
        runId,
        toolCallId: event.toolCallId ?? generateId(),
        result: resultPayload,
        success: event.success,
        durationMs: event.durationMs,
      });
      break;
    }

    case "InterruptRequested":
      // Publish interrupt request to hub for UI to handle
      console.log("[Chat] InterruptRequested:", event.toolName, event.args);
      aguiEvent = createEvent<InterruptRequested>("InterruptRequested", threadId, {
        runId,
        toolCallId: event.toolCallId ?? generateId(),
        toolName: event.toolName ?? "unknown",
        args: event.args ? jsonPayload(event.args.data ?? event.args) : undefined,
      });
      break;

    case "InterruptResolved":
      console.log("[Chat] InterruptResolved:", event);
      aguiEvent = createEvent<InterruptResolved>("InterruptResolved", threadId, {
        runId,
        toolCallId: event.toolCallId,
        approved: event.approved ?? false,
        reason: event.reason,
      });
      break;

    case "ArtifactCreated": {
      console.log("[Chat] ArtifactCreated:", event.name, event.mimeType, event.url);
      const artifactId = event.artifactId ?? generateId();
      aguiEvent = createEvent<ArtifactCreated>("ArtifactCreated", threadId, {
        runId,
        toolCallId: event.toolCallId,
        artifactId,
        url: event.url ?? "",
        name: event.name ?? "artifact",
        mimeType: event.mimeType ?? "application/octet-stream",
      });
      // Relink the artifact's run_id to the AGUI runId so it matches
      // the assistant message's runId when loading thread history
      relinkArtifactRun({
        artifactId,
        aguiRunId: runId,
        threadId,
        toolCallId: event.toolCallId,
        mimeType: event.mimeType,
        name: event.name,
        url: event.url,
      });
      break;
    }

    default:
      // Log unknown event types
      console.log("[Chat] Unknown event type:", event.type);
  }

  if (aguiEvent) {
    saveEvent(aguiEvent);
    hub.publish(threadId, aguiEvent);
  }
  return aguiEvent;
}

/**
 * Check if images are present in messages
 */
function hasImageContent(messages: Array<{ role: string; content: unknown }>): boolean {
  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "image_url" || part.type === "image") {
          return true;
        }
      }
    }
    if (typeof msg.content === "string") {
      if (msg.content.includes("[Image:") || msg.content.includes("image_id:")) {
        return true;
      }
    }
  }
  return false;
}

export async function POST(req: Request) {
  // Parse and validate request body
  let body: ChatRequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { messages, model, threadId, uploadIds } = body;

  // Validate messages array
  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response(JSON.stringify({ error: "messages array is required and must not be empty" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Get provider config for LLM settings
  const systemProfile = getSystemProfile();
  const providerCfg = getProviderConfig();
  const hasImages = hasImageContent(messages);

  const clientSlot = hasImages && providerCfg.vision ? "vision" : "primary";
  const activeConfig = providerCfg[clientSlot];

  if (!activeConfig) {
    return new Response(JSON.stringify({ error: `provider slot "${clientSlot}" is not configured` }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Model selection priority: request > selected provider slot > primary slot > system profile > fallback
  const selectedModel =
    model ??
    getDefaultModel(clientSlot) ??
    (clientSlot !== "primary" ? getDefaultModel("primary") : undefined) ??
    systemProfile.recommended.textModel ??
    (hasImages ? "llama3.2-vision:11b" : "llama3.2:3b");

  const thread = threadId ?? generateId();
  const runId = generateId();
  const messageId = generateId();

  // Probe Agent-GO up front. If it's down (common during local dev without
  // the Go binary), fall through to /api/chat/simple so chat still works.
  // The probe is non-blocking at 400ms — Agent-GO's /health is an instant
  // response when alive, so this adds essentially zero latency to the
  // healthy path.
  const agentgoAlive = await fetch(`${AGENTGO_URL}/health`, {
    signal: AbortSignal.timeout(400),
    cache: "no-store",
  })
    .then((r) => r.ok)
    .catch(() => false);

  // Free-tier mode: when the client opts in, skip Agent-GO entirely and
  // route through OpenRouter's free-model roulette. User-visible privacy
  // tradeoff (free tiers may train on prompts) — enforced client-side by
  // the FreeModeToggle opt-in.
  //
  // Ordering note: this branch is intentionally evaluated BEFORE the
  // Agent-GO probe. Free mode is an explicit user override, not a
  // fallback. If free has no valid keys or all models are exhausted, the
  // user sees a clean 501/429 in the stream rather than a surprise local
  // cascade — that surprise would hide exactly the quota/key problem the
  // user needs to fix.
  // New header: `x-deck-route-mode: local | free`. Back-compat: the old
  // `x-deck-free-mode: 1` still means "free". Anything unset defaults
  // to local (Agent-GO / simple / Ollama).
  const routeModeHeader = req.headers.get("x-deck-route-mode");
  const legacyFreeHeader = req.headers.get("x-deck-free-mode") === "1";
  const freeMode = routeModeHeader === "free" || legacyFreeHeader;
  if (freeMode) {
    console.log(`[Chat] Free mode active — delegating to /api/chat/free (preferred=${model ?? "<none>"})`);
    const { POST: freePost } = await import("./free/route");
    const freeReq = new Request(new URL("/api/chat/free", req.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages,
        threadId: thread,
        needsMultimodal: hasImages,
        // Raw user intent, not the resolved selectedModel — we want the
        // string the user actually clicked, not any server-side fallback.
        preferredModel: model,
      }),
      signal: req.signal,
    });
    return freePost(freeReq);
  }

  if (!agentgoAlive) {
    console.log(`[Chat] Agent-GO unreachable at ${AGENTGO_URL}; falling back to /api/chat/simple`);
    // Invoke the simple route's handler directly instead of HTTP self-fetch.
    // Next's dev server can buffer or serialize recursive same-origin fetches,
    // which manifested as a hung SSE stream during testing.
    const { POST: simplePost } = await import("./simple/route");
    const fallbackReq = new Request(new URL("/api/chat/simple", req.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, model: selectedModel, threadId: thread }),
      signal: req.signal,
    });
    return simplePost(fallbackReq);
  }

  console.log(`[Chat] Starting run via Agent-GO: thread=${thread}, model=${selectedModel}`);

  // Emit local RunStarted (for immediate UI feedback)
  const lastMessage = messages[messages.length - 1]?.content;
  const runStarted = createEvent<RunStarted>("RunStarted", thread, {
    runId,
    model: selectedModel,
    input: lastMessage ? jsonPayload(lastMessage) : undefined,
  });
  createRun(runId, thread, selectedModel);
  saveEvent(runStarted);
  hub.publish(thread, runStarted);

  // Emit TextMessageStart locally
  const msgStart = createEvent<TextMessageStart>("TextMessageStart", thread, {
    runId,
    messageId,
    role: "assistant",
  });
  saveEvent(msgStart);
  hub.publish(thread, msgStart);

  // Prepare Agent-GO request — strip fake patterns from assistant messages
  // to prevent the LLM from learning to fake tool calls (SURFACE.md §4.3)
  const agentMessages: AgentGOMessage[] = messages
    .map(m => {
      const rawContent = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      const content = m.role === "assistant" ? stripForLLMHistory(rawContent) : rawContent;
      return {
        role: m.role as AgentGOMessage["role"],
        content: content || "[Previous response contained only generated content]",
      };
    })
    .filter(m => m.content.trim().length > 0);

  const agentRequest: AgentGOStartRunRequest = {
    messages: agentMessages,
    thread_id: thread,
    workspace_root: process.env.WORKSPACE_ROOT ?? undefined,
    mode: "BUILD",
    max_steps: parseInt(process.env.AGENT_MAX_STEPS ?? "25", 10),
    llm: {
      base_url: activeConfig.baseURL,
      model: selectedModel,
      api_key: activeConfig.apiKey,
    },
    tool_bridge_url: TOOL_BRIDGE_URL,
  };

  // Create SSE streaming response
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  let isAborted = false;
  req.signal?.addEventListener("abort", () => {
    isAborted = true;
  });

  /** Write an SSE-formatted event to the response stream */
  const safeWriteSSE = async (event: object): Promise<boolean> => {
    if (isAborted) return false;
    try {
      await writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      return true;
    } catch (err) {
      console.error("[Chat] Stream write failed:", err);
      isAborted = true;
      return false;
    }
  };

  // Background task to proxy Agent-GO events as SSE
  (async () => {
    let agentRunId: string | null = null;
    let fullText = "";

    try {
      // Write initial locally-emitted events to the SSE stream
      await safeWriteSSE(runStarted);
      await safeWriteSSE(msgStart);

      // Start run on Agent-GO. retryingFetch handles network errors + 5xx
      // with exponential backoff so a brief Agent-GO hiccup doesn't break
      // the chat turn; 4xx still fails fast.
      const startResponse = await retryingFetch(`${AGENTGO_URL}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(agentRequest),
        signal: req.signal,
      });

      if (!startResponse.ok) {
        const errorText = await startResponse.text();
        throw new Error(`Agent-GO returned ${startResponse.status}: ${errorText}`);
      }

      const startData = await startResponse.json();
      agentRunId = startData.run_id;
      console.log(`[Chat] Agent-GO run started: ${agentRunId}`);
      if (agentRunId) setAgentRunId(runId, agentRunId);

      // Stream events from Agent-GO. Retry the initial connect; mid-stream
      // reconnect would need server seq coordination, so we accept that a
      // dropped SSE connection ends the run.
      const eventsResponse = await retryingFetch(
        `${AGENTGO_URL}/runs/${agentRunId}/events`,
        {
          headers: { Accept: "text/event-stream" },
          signal: req.signal,
        }
      );

      if (!eventsResponse.ok) {
        throw new Error(`Agent-GO events returned ${eventsResponse.status}`);
      }

      const reader = eventsResponse.body?.getReader();
      if (!reader) {
        throw new Error("No response body from Agent-GO");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (!data || data === "[DONE]") continue;

            const event = parseSSE(data);
            if (!event) continue;

            // Track text for run preview
            if (event.type === "TextMessageContent" && event.delta) {
              fullText += event.delta;
            }

            // Map to AGUI event, save to DB, publish to hub (for other consumers)
            const aguiEvent = mapAndPublishEvent(event, thread, runId, messageId);

            // Write the AGUI event to the SSE response stream
            if (aguiEvent) {
              if (!await safeWriteSSE(aguiEvent)) break;
            }

            // Check for run completion
            if (event.type === "RunFinished" || event.type === "RunError") {
              break;
            }
          } else if (line.startsWith("event: done")) {
            // Agent-GO signals completion
            break;
          }
        }
      }

      reader.releaseLock();

      // Update run preview
      if (fullText) {
        updateRunPreview(runId, fullText.slice(0, 200));
      }

      // Emit and stream TextMessageEnd
      const msgEnd = createEvent<TextMessageEnd>("TextMessageEnd", thread, {
        runId,
        messageId,
      });
      saveEvent(msgEnd);
      hub.publish(thread, msgEnd);
      await safeWriteSSE(msgEnd);

      // Emit and stream RunFinished — include LLM-generated title (SURFACE.md §6.2)
      const threadRow = getThread(thread);
      const runFinished = createEvent<RunFinished>("RunFinished", thread, {
        runId,
        threadTitle: threadRow?.title || undefined,
      });
      finishRun(runId, 0, 0, 0);
      saveEvent(runFinished);
      hub.publish(thread, runFinished);
      await safeWriteSSE(runFinished);

    } catch (error) {
      if (isAborted) {
        console.log("[Chat] Request aborted during Agent-GO proxy");
      } else {
        const unavailable = error instanceof AgentGoUnavailableError;
        const errMsg = unavailable
          ? `Agent-GO at ${AGENTGO_URL} is unreachable (tried ${error.attempts}×). Start it with ./start-full-stack.sh or set AGENTGO_URL.`
          : error instanceof Error
            ? error.message
            : "Unknown error";
        console.error("[Chat] Agent-GO proxy error:", error);

        const runError = createEvent<RunError>("RunError", thread, {
          runId,
          error: { message: errMsg, code: unavailable ? "AGENTGO_UNAVAILABLE" : undefined },
        });
        errorRun(runId, errMsg);
        saveEvent(runError);
        hub.publish(thread, runError);
        await safeWriteSSE(runError);
      }
    } finally {
      await writer.close().catch((err) => console.warn("[Chat] writer.close failed:", err));
    }
  })();

  // Return SSE streaming response
  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Thread-Id": thread,
      "X-Run-Id": runId,
      "X-Message-Id": messageId,
      "Access-Control-Expose-Headers": "X-Thread-Id, X-Run-Id, X-Message-Id",
    },
  });
}

/**
 * Direct tool execution endpoint (for manual triggers)
 * PUT /api/chat - Execute a tool directly without LLM
 * 
 * This remains unchanged - uses local executor
 */
export async function PUT(req: Request) {
  // Dynamic import to avoid bundling executor in main chat route
  const { executeToolWithGlyph } = await import("@/lib/tools/executor");

  let body: { tool?: string; args?: Record<string, unknown>; threadId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { tool, args, threadId } = body;

  // Validate tool name
  if (!tool || typeof tool !== "string") {
    return Response.json({ success: false, error: "tool name is required" }, { status: 400 });
  }

  const thread = threadId ?? generateId();
  const runId = generateId();
  const toolCallId = generateId();

  const ctx = {
    threadId: thread,
    runId,
    toolCallId,
  };

  createRun(runId, thread, "tool:" + tool);

  try {
    // Same approval gate as /api/tools/bridge — dynamic import to avoid
    // pulling the approvals spine into the chat-route initial bundle.
    const { gateToolCall } = await import("@/lib/approvals/gate");
    const verdict = await gateToolCall({
      toolName: tool,
      toolArgs: (args ?? {}) as Record<string, unknown>,
      runId,
      threadId: thread,
    });
    if (verdict.decision === "denied") {
      errorRun(runId, verdict.reason);
      return Response.json(
        { success: false, error: `tool call denied: ${verdict.reason}`, runId, threadId: thread },
        { status: 403 },
      );
    }

    const toolCall = { name: tool, args: args ?? {} } as Parameters<typeof executeToolWithGlyph>[0];
    const result = await executeToolWithGlyph(toolCall, ctx);

    finishRun(runId, 0, 0, 0);

    return Response.json({
      success: result.success,
      message: result.message,
      artifacts: result.artifacts,
      runId,
      threadId: thread,
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    errorRun(runId, errMsg);

    return Response.json(
      { success: false, error: errMsg, runId, threadId: thread },
      { status: 500 }
    );
  }
}
