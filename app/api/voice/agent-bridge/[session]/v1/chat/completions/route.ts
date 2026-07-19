import { POST as chatPost } from "@/app/api/chat/route";
import { getMessages, saveMessage } from "@/lib/agui/db";
import { generateId } from "@/lib/agui/events";
import { AGENTGO_URL, withAgentTsAuth } from "@/lib/agentgo/launcher";
import { resolveSessionThread } from "@/lib/voice/agent-bridge/session-store";
import { transcodeAguiToOpenAI } from "@/lib/voice/agent-bridge/openai-sse";
import { jsonError } from "@/lib/http/json";

interface ChatCompletionMessageParam {
  role?: string;
  content?: unknown;
}

interface ChatCompletionCreateParams {
  model?: unknown;
  messages?: ChatCompletionMessageParam[];
  stream?: unknown;
}

type ChatRole = "user" | "assistant";

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const record = part as Record<string, unknown>;
      if (typeof record.text === "string") return record.text;
      if (typeof record.input_text === "string") return record.input_text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function extractLastUserText(messages: unknown): string | null {
  if (!Array.isArray(messages)) return null;

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] as ChatCompletionMessageParam;
    if (!message || typeof message !== "object" || message.role !== "user") continue;
    const text = textFromContent(message.content).trim();
    return text || null;
  }

  return null;
}

function completionModel(body: ChatCompletionCreateParams): string {
  return typeof body.model === "string" && body.model.trim()
    ? body.model
    : "control-deck-agent";
}

function asChatRole(role: string): ChatRole | null {
  return role === "user" || role === "assistant" ? role : null;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ session: string }> },
) {
  const { session } = await ctx.params;
  if (!session) return jsonError("session is required");

  let body: ChatCompletionCreateParams;
  try {
    body = await req.json() as ChatCompletionCreateParams;
  } catch {
    return jsonError("Invalid JSON body");
  }

  const text = extractLastUserText(body.messages);
  if (!text) return jsonError("A user message with text content is required");

  const threadId = resolveSessionThread(session);
  const runId = generateId();
  const userMessageId = generateId();
  const completionId = `chatcmpl-${runId}`;
  const model = completionModel(body);

  saveMessage({
    id: userMessageId,
    threadId,
    role: "user",
    content: text,
    runId,
  });

  const history = getMessages(threadId)
    .filter((message) => message.id !== userMessageId)
    .map((message) => {
      const role = asChatRole(message.role);
      return role ? { role, content: message.content } : null;
    })
    .filter((message): message is { role: ChatRole; content: string } => Boolean(message));

  const messages = [...history, { role: "user" as const, content: text }];
  const origin = new URL(req.url).origin;
  const internalAbort = new AbortController();

  let cancelSent = false;
  const cancelAgentRun = () => {
    if (cancelSent) return;
    cancelSent = true;
    internalAbort.abort();
    void fetch(`${AGENTGO_URL}/runs/${runId}/cancel`, {
      method: "POST",
      headers: withAgentTsAuth({ "Content-Type": "application/json" }),
    }).catch((err) => {
      console.warn("[agent-bridge] cancel request failed:", err);
    });
  };

  if (req.signal.aborted) {
    cancelAgentRun();
  } else {
    req.signal.addEventListener("abort", cancelAgentRun, { once: true });
  }

  let upstream: Response;
  try {
    upstream = await chatPost(new Request(new URL("/api/chat", origin), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({
        messages,
        threadId,
        runId,
        voice: {
          turnId: runId,
          runId,
          routeId: "realtime-s2s",
          mode: "chat",
          surface: "voice",
          source: "realtime",
          modality: "voice",
        },
      }),
      signal: internalAbort.signal,
    }));
  } catch (err) {
    req.signal.removeEventListener("abort", cancelAgentRun);
    const message = err instanceof Error ? err.message : "Unable to start agent run";
    return jsonError(message, 502);
  }

  if (!upstream.body) {
    req.signal.removeEventListener("abort", cancelAgentRun);
    return jsonError("Chat route returned no stream", 502);
  }

  const stream = transcodeAguiToOpenAI(upstream.body, {
    id: completionId,
    model,
    signal: req.signal,
    keepAliveMs: 5000,
    onFinish: (assistantText) => {
      saveMessage({
        id: generateId(),
        threadId,
        role: "assistant",
        content: assistantText,
        runId,
      });
    },
    onClose: () => {
      req.signal.removeEventListener("abort", cancelAgentRun);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      "X-Run-Id": runId,
      "X-Thread-Id": threadId,
      "Access-Control-Expose-Headers": "X-Run-Id, X-Thread-Id",
    },
  });
}
