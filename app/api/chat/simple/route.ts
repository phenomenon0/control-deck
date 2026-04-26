/**
 * POST /api/chat/simple — direct-to-llama.cpp chat. No agent dependency.
 *
 * A lightweight fallback / alternative agent for when the agent runtime
 * is down or you just want to test the deck's chat surface against the
 * local model. Streams AGUI events (RunStarted / TextMessageContent /
 * RunFinished) so `useAgentRun` consumes it identically to the agent
 * path. Calls llama-server's OpenAI-compat /v1/chat/completions.
 *
 * No tools, no multi-step reasoning — plain text streaming. If you want
 * tool-calling + agent loops, run the agent runtime and use /api/chat.
 */

import { NextResponse } from "next/server";
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
} from "@/lib/agui/events";
import { jsonPayload } from "@/lib/agui/payload";
import {
  createRun,
  finishRun,
  errorRun,
  saveEvent,
  updateRunPreview,
} from "@/lib/agui/db";
import { resolveProviderUrl } from "@/lib/hardware/settings";
import { prepareForModel } from "@/lib/llm/systemPrompt";

interface SimpleChatBody {
  messages?: Array<{ role: string; content: string }>;
  model?: string;
  threadId?: string;
  systemPrompt?: string;
}

interface OpenAIStreamChoice {
  delta?: { role?: string; content?: string };
  finish_reason?: string | null;
}
interface OpenAIStreamChunk {
  id?: string;
  model?: string;
  choices?: OpenAIStreamChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

interface OpenAIModelRow {
  id: string;
}

/**
 * llama-server binds one model per process, so the resolution strategy
 * is simpler than Ollama's: try the requested id verbatim; if /v1/models
 * doesn't list it, fall back to whatever the server is actually serving.
 */
async function resolveServedModel(requested: string): Promise<string> {
  try {
    const url = resolveProviderUrl("llamacpp");
    const res = await fetch(`${url}/v1/models`, {
      signal: AbortSignal.timeout(1200),
      cache: "no-store",
    });
    if (!res.ok) return requested;
    const data = (await res.json()) as { data?: OpenAIModelRow[] };
    const ids = (data.data ?? []).map((m) => m.id);
    if (ids.length === 0) return requested;
    if (ids.includes(requested)) return requested;
    return ids[0];
  } catch {
    return requested;
  }
}

export async function POST(req: Request) {
  let body: SimpleChatBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const { messages, model, threadId, systemPrompt } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "messages array required" }, { status: 400 });
  }
  const requested =
    model ??
    process.env.LLAMACPP_MODEL ??
    process.env.LLM_MODEL ??
    process.env.OLLAMA_MODEL ??
    "";
  const selectedModel = (await resolveServedModel(requested)) || "default";
  // llama-server is OpenAI-compatible, so `prepared.system` will be null
  // and `prepared.messages` carries role:"system". Using prepareForModel
  // keeps this route identically shaped to the agent path and makes
  // future-adapter additions (Claude, Gemini) a matter of updating the
  // helper, not the call sites.
  const prepared = prepareForModel(messages, systemPrompt ?? "", selectedModel);
  const finalMessages = prepared.messages;
  const thread = threadId ?? generateId();
  const runId = generateId();
  const messageId = generateId();

  const runStarted = createEvent<RunStarted>("RunStarted", thread, {
    runId,
    model: selectedModel,
    input: jsonPayload(messages[messages.length - 1]?.content ?? ""),
  });
  createRun(runId, thread, selectedModel);
  saveEvent(runStarted);
  hub.publish(thread, runStarted);

  const msgStart = createEvent<TextMessageStart>("TextMessageStart", thread, {
    runId,
    messageId,
    role: "assistant",
  });
  saveEvent(msgStart);
  hub.publish(thread, msgStart);

  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  let isAborted = false;
  req.signal?.addEventListener("abort", () => {
    isAborted = true;
  });

  const writeSSE = async (evt: object): Promise<boolean> => {
    if (isAborted) return false;
    try {
      await writer.write(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`));
      return true;
    } catch {
      isAborted = true;
      return false;
    }
  };

  (async () => {
    let fullText = "";
    let inputTokens = 0;
    let outputTokens = 0;
    try {
      await writeSSE(runStarted);
      await writeSSE(msgStart);

      const llamacppUrl = resolveProviderUrl("llamacpp");
      const res = await fetch(`${llamacppUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: selectedModel,
          messages: finalMessages.map((m) => ({ role: m.role, content: m.content })),
          stream: true,
          stream_options: { include_usage: true },
        }),
        signal: req.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`llama.cpp ${res.status}: ${await res.text().catch(() => "")}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (!isAborted) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // OpenAI-compat SSE: blank-line-delimited frames, each starting
        // with "data: ". Final frame is "data: [DONE]".
        let frameEnd: number;
        while ((frameEnd = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, frameEnd);
          buffer = buffer.slice(frameEnd + 2);
          for (const rawLine of frame.split("\n")) {
            const line = rawLine.trim();
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            let chunk: OpenAIStreamChunk;
            try {
              chunk = JSON.parse(payload);
            } catch {
              continue;
            }
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) {
              fullText += delta;
              const evt = createEvent<TextMessageContent>("TextMessageContent", thread, {
                runId,
                messageId,
                delta,
              });
              saveEvent(evt);
              hub.publish(thread, evt);
              await writeSSE(evt);
            }
            if (chunk.usage) {
              inputTokens = chunk.usage.prompt_tokens ?? inputTokens;
              outputTokens = chunk.usage.completion_tokens ?? outputTokens;
            }
          }
        }
      }

      const msgEnd = createEvent<TextMessageEnd>("TextMessageEnd", thread, {
        runId,
        messageId,
      });
      saveEvent(msgEnd);
      hub.publish(thread, msgEnd);
      await writeSSE(msgEnd);

      const runFinished = createEvent<RunFinished>("RunFinished", thread, {
        runId,
        output: jsonPayload(fullText),
        inputTokens,
        outputTokens,
        costUsd: 0, // local model, free
      });
      finishRun(runId, inputTokens, outputTokens, 0);
      if (fullText) updateRunPreview(runId, fullText);
      saveEvent(runFinished);
      hub.publish(thread, runFinished);
      await writeSSE(runFinished);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "simple chat failed";
      const runErr = createEvent<RunError>("RunError", thread, {
        runId,
        error: { message: msg },
      });
      errorRun(runId, msg);
      saveEvent(runErr);
      hub.publish(thread, runErr);
      await writeSSE(runErr);
    } finally {
      try {
        await writer.close();
      } catch {
        /* ignore */
      }
    }
  })();

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
