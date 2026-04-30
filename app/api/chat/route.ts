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
import { prepareForModel } from "@/lib/llm/systemPrompt";
import {
  createRun,
  createThread,
  finishRun,
  errorRun,
  updateRunPreview,
  saveEvent,
  saveMessage,
  getThread,
  type MessageMetadata,
} from "@/lib/agui/db";
import { getDefaultModel, getProviderConfig } from "@/lib/llm";
import { resolveTextProviderFromBinding } from "@/lib/inference/text-binding";
import { defaultFor, type LocalPreset } from "@/lib/inference/local-defaults";
import { getSystemProfile } from "@/lib/system";
import { stripForLLMHistory } from "@/lib/chat/stripPatterns";
import { retryingFetch, AgentGoUnavailableError } from "@/lib/agentgo/client";
import { buildToolBridgeUrl, buildMcpToolsUrl } from "@/lib/tools/bridge-url";
// Agent runtime selection. Default is the TS implementation (apps/agent-ts)
// on :4244; set AGENT_RUNTIME=go (or USE_AGENT_GO=1) to pin the legacy Go
// binary. URL resolution lives in `lib/agentgo/launcher.ts` so launch + chat
// + approve/reject stay aligned.
import { AGENTGO_URL, withAgentTsAuth } from "@/lib/agentgo/launcher";

// Module-level health cache. The probe at the top of POST() is a 400ms
// blocking fetch on every chat request; on voice turns this directly
// inflates first-token latency. Cache positive and negative results so
// the probe runs at most once per TTL window.
//
// TTL split: positive cached for 30s (agent-go is stable once up), negative
// cached for 5s only (so a freshly-started agent is picked up quickly
// without forcing the user to restart Next).
let agentgoHealthCache: { alive: boolean; checkedAt: number } | null = null;
const AGENTGO_HEALTH_TTL_OK_MS = 30_000;
const AGENTGO_HEALTH_TTL_DOWN_MS = 5_000;

async function probeAgentGoHealth(): Promise<boolean> {
  const now = Date.now();
  if (agentgoHealthCache) {
    const ttl = agentgoHealthCache.alive
      ? AGENTGO_HEALTH_TTL_OK_MS
      : AGENTGO_HEALTH_TTL_DOWN_MS;
    if (now - agentgoHealthCache.checkedAt < ttl) {
      return agentgoHealthCache.alive;
    }
  }
  const alive = await fetch(`${AGENTGO_URL}/health`, {
    signal: AbortSignal.timeout(400),
    cache: "no-store",
  })
    .then((r) => r.ok)
    .catch(() => false);
  agentgoHealthCache = { alive, checkedAt: now };
  return alive;
}

interface ChatRequestBody {
  messages?: Array<{ role: string; content: string; metadata?: MessageMetadata }>;
  model?: string;
  threadId?: string;
  uploadIds?: string[];
  /** User-editable system prompt. Augmented per-model in each route. */
  systemPrompt?: string;
  /**
   * Local-first quality preset. Only used as a fallback when `model` is
   * empty and env/runtime configs have nothing to offer either. Explicit
   * pins always win.
   */
  preset?: LocalPreset;
  /**
   * Voice provenance metadata. Present when this turn was originated from
   * the audio dock / conductor. Lets the run ledger and downstream tool
   * policy distinguish a typed turn from a spoken one.
   */
  voice?: {
    turnId: string;
    runId?: string;
    routeId: string;
    mode: string;
    surface: string;
    source: string;
    modality: "voice";
  };
}

const VALID_PRESETS = new Set<LocalPreset>(["quick", "balanced", "quality"]);

interface AgentGOMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
}

interface AgentGOStartRunRequest {
  messages: AgentGOMessage[];
  thread_id: string;
  /**
   * Canonical AG-UI run id. agent-ts honours it so all events downstream
   * of /runs share the same id Next created here. Replaces the legacy
   * `setAgentRunId` reconciliation step removed in the cd47211 cleanup.
   */
  run_id?: string;
  workspace_root?: string;
  mode?: string;
  max_steps?: number;
  llm?: {
    base_url?: string;
    model?: string;
    api_key?: string;
  };
  tool_bridge_url?: string;
  mcp_url?: string;
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
      // Artifact rows are inserted upstream (lib/tools/executor.ts via
      // createArtifact, apps/agent-ts loop.ts via the bridge response)
      // already keyed to the canonical AG-UI runId. The legacy
      // relinkArtifactRun() reconciliation is no longer needed.
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

  const {
    messages,
    model,
    threadId,
    uploadIds,
    systemPrompt: clientPrompt,
    preset: presetRaw,
    voice,
  } = body;

  if (voice) {
    console.log(
      `[Chat] voice turn ${voice.turnId} mode=${voice.mode} route=${voice.routeId} source=${voice.source} surface=${voice.surface}`,
    );
  }

  const preset: LocalPreset =
    presetRaw && VALID_PRESETS.has(presetRaw) ? presetRaw : "balanced";

  // Ensure the thread row exists before anything else reads from it.
  // INSERT OR IGNORE — no-op if already present. Closes a latent race
  // where /api/chat was previously assuming the client pre-created via
  // /api/threads, which silently made getThread() return undefined and
  // per-thread overrides impossible.
  if (threadId) createThread(threadId);

  // Thread-scoped override: if the thread has a system_prompt set, use
  // that instead of whatever the client sent. Lets users keep per-thread
  // personas ("this thread is for code") without mutating global prefs.
  const thread0 = threadId ? getThread(threadId) : undefined;
  const systemPrompt = thread0?.system_prompt ?? clientPrompt;

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
  // Inference-bindings overlay: when the user has explicitly bound
  // `text::primary` via the Modalities panel (or PUT /api/inference/bindings),
  // that intent should drive every chat request. Without this overlay the
  // chat route silently ignores the slot bindings, so "swap LLM provider in
  // settings" does nothing for the typed surface.
  const textBinding = resolveTextProviderFromBinding();
  if (textBinding) {
    providerCfg.primary = textBinding;
  }
  const hasImages = hasImageContent(messages);

  const clientSlot = hasImages && providerCfg.vision ? "vision" : "primary";
  const activeConfig = providerCfg[clientSlot];

  if (!activeConfig) {
    return new Response(JSON.stringify({ error: `provider slot "${clientSlot}" is not configured` }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Model selection precedence — two storage layers meet here:
  //   1. `model` from body  ← user pick in DeckPrefs (localStorage, client)
  //   2. getDefaultModel(slot) ← env LLM_* / runtime override (provider
  //      config store, server)
  //   3. systemProfile recommendation ← hardware-probed fallback
  //   4. hardcoded last-resort string
  //
  // The two stores are NOT synced intentionally. DeckPrefs.model is "what
  // the user clicked in the UI"; getProviderConfig()/getDefaultModel() is
  // "how this server knows to talk to a provider by default." The user
  // always wins when set, because composer pill > inherited config.
  // When prefs.model is empty (first run, or user cleared it), the server
  // config supplies a sane default so chat still works.
  //
  // To change the system-wide default without clicking in the UI, set
  // LLM_MODEL in env or call /api/backend to write runtimeOverride.
  // Preset-driven local-first rung: only kicks in when no explicit pin and
  // no env/runtime override exist. `defaultFor` returns the manifest id for
  // the active modality at the active preset — matches what the Models pane
  // recommends and pulls.
  const presetLocalModel =
    defaultFor(hasImages ? "vision" : "text", preset).id ?? undefined;

  const selectedModel =
    model ??
    // Binding's pinned model — fired when the user picked one in Modalities.
    // Sits above getDefaultModel so a binding always wins over env defaults.
    textBinding?.model ??
    getDefaultModel(clientSlot) ??
    (clientSlot !== "primary" ? getDefaultModel("primary") : undefined) ??
    presetLocalModel ??
    systemProfile.recommended.textModel ??
    (hasImages ? "llama3.2-vision:11b" : "llama3.2:3b");

  const thread = threadId ?? generateId();
  // Honour a client-supplied runId so the voice surface can target a
  // specific run for cancel before the server has a chance to round-trip
  // its own id back. agent-ts already accepts the same id we generate
  // here, so the whole chain shares one runId.
  const runId = voice?.runId ?? generateId();
  const messageId = generateId();

  // Probe Agent-GO up front. If it's down (common during local dev without
  // the Go binary), fall through to /api/chat/simple so chat still works.
  // Cached at the module level so voice turns don't pay the 400ms timeout
  // on every utterance — see probeAgentGoHealth() above.
  const agentgoAlive = await probeAgentGoHealth();

  // Chat is local-only. Cloud + free-tier branches were retired — the
  // chat surface ships no online sources. The agent runtime selection
  // still lives in `lib/agentgo/launcher.ts` (TS by default, Go opt-in).
  if (!agentgoAlive) {
    console.log(`[Chat] Agent-GO unreachable at ${AGENTGO_URL}; falling back to /api/chat/simple`);
    // Invoke the simple route's handler directly instead of HTTP self-fetch.
    // Next's dev server can buffer or serialize recursive same-origin fetches,
    // which manifested as a hung SSE stream during testing.
    const { POST: simplePost } = await import("./simple/route");
    const fallbackReq = new Request(new URL("/api/chat/simple", req.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, model: selectedModel, threadId: thread, systemPrompt }),
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
  const agentMessagesRaw: AgentGOMessage[] = messages
    .map(m => {
      const rawContent = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      const content = m.role === "assistant" ? stripForLLMHistory(rawContent) : rawContent;
      return {
        role: m.role as AgentGOMessage["role"],
        content: content || "[Previous response contained only generated content]",
      };
    })
    .filter(m => m.content.trim().length > 0);

  // Prepend the user's system prompt (augmented for the target model)
  // so Agent-GO forwards it to the LLM as the first message. Agent-GO's
  // own baked-in prompt still runs — these two stack.
  //
  // Agent-GO itself talks OpenAI-compatible downstream, so we pass the
  // messages with role:"system". If the user eventually configures
  // Agent-GO to talk directly to Claude/Gemini, that's an Agent-GO side
  // concern — we hand it the prepared messages and let it adapt.
  const prepared = prepareForModel(agentMessagesRaw, systemPrompt ?? "", selectedModel);
  const agentMessages: AgentGOMessage[] = prepared.messages as AgentGOMessage[];

  const agentRequest: AgentGOStartRunRequest = {
    messages: agentMessages,
    thread_id: thread,
    run_id: runId,
    workspace_root: process.env.WORKSPACE_ROOT ?? undefined,
    mode: "BUILD",
    max_steps: parseInt(process.env.AGENT_MAX_STEPS ?? "25", 10),
    llm: {
      base_url: activeConfig.baseURL,
      model: selectedModel,
      api_key: activeConfig.apiKey,
    },
    tool_bridge_url: buildToolBridgeUrl(req),
    mcp_url: buildMcpToolsUrl(req),
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
        headers: withAgentTsAuth({ "Content-Type": "application/json" }),
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
      // Canonical-runId invariant: agent-ts must echo back the run_id we
      // sent in agentRequest. A divergence here means an agent-ts build
      // ignored req.run_id and allocated its own — the legacy reconcile
      // path is gone, so this would silently break artifact/run linkage.
      if (agentRunId && agentRunId !== runId) {
        console.warn(
          `[Chat] agent-ts run id divergence: deck=${runId} agent=${agentRunId}`,
        );
      }

      // Stream events from Agent-GO. Retry the initial connect; mid-stream
      // reconnect would need server seq coordination, so we accept that a
      // dropped SSE connection ends the run.
      const eventsResponse = await retryingFetch(
        `${AGENTGO_URL}/runs/${agentRunId}/events`,
        {
          headers: withAgentTsAuth({ Accept: "text/event-stream" }),
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
      let upstreamErrorMessage: string | null = null;

      outer: while (true) {
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
              if (!await safeWriteSSE(aguiEvent)) break outer;
            }

            // Check for run completion. RunError must NOT fall through to
            // the post-loop finishRun path — that would overwrite the
            // error status with 'finished'.
            if (event.type === "RunFinished") {
              break outer;
            }
            if (event.type === "RunError") {
              upstreamErrorMessage = event.error?.message ?? "agent error";
              break outer;
            }
          } else if (line.startsWith("event: done")) {
            // Agent-GO signals completion
            break outer;
          }
        }
      }

      reader.releaseLock();

      // Update run preview
      if (fullText) {
        updateRunPreview(runId, fullText.slice(0, 200));
      }

      if (upstreamErrorMessage !== null) {
        // Agent-ts surfaced its own RunError (most commonly "aborted" after
        // a /cancel). The event itself was already forwarded to the SSE
        // stream and hub above; here we just persist the run row state.
        errorRun(runId, upstreamErrorMessage);
      } else {
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
      }

    } catch (error) {
      if (isAborted) {
        console.log("[Chat] Request aborted during Agent-GO proxy");
        // Mark the run row aborted so the SQLite ledger doesn't leave it
        // as 'running' forever when the user closes the tab or interrupts
        // before /cancel can round-trip. Idempotent with the cancel route.
        try {
          errorRun(runId, "aborted");
        } catch (dbErr) {
          console.warn("[Chat] errorRun(aborted) failed:", dbErr);
        }
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
