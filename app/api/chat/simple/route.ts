/**
 * POST /api/chat/simple — direct-to-Ollama chat. No Agent-GO dependency.
 *
 * A lightweight fallback / alternative agent for when Agent-GO is down or
 * you just want to test the deck's chat surface against a local model.
 * Streams AGUI events (RunStarted / TextMessageContent / RunFinished) so
 * `useAgentRun` consumes it identically to the Agent-GO path.
 *
 * No tools, no multi-step reasoning — plain text streaming. If you want
 * tool-calling + agent loops, run Agent-GO and use /api/chat.
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

interface OllamaChunk {
  model: string;
  message?: { role: string; content: string };
  done: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
  total_duration?: number;
}

interface OllamaTag {
  name: string;
  details?: { family?: string };
}

/**
 * Tolerant model resolution: exact match first, then prefix/basename
 * match (so "qwen2" snaps to "qwen3:0.6b" when qwen2 isn't installed),
 * finally first non-embedder installed model. Prevents the "model not
 * found" 404 when the persisted default doesn't match what's on disk.
 */
async function resolveInstalledModel(requested: string): Promise<string> {
  try {
    const ollamaUrl = resolveProviderUrl("ollama");
    const res = await fetch(`${ollamaUrl}/api/tags`, {
      signal: AbortSignal.timeout(1200),
      cache: "no-store",
    });
    if (!res.ok) return requested;
    const data = (await res.json()) as { models?: OllamaTag[] };
    const tags = data.models ?? [];
    if (tags.length === 0) return requested;

    // 1. Exact match.
    if (tags.some((m) => m.name === requested)) return requested;

    // 2. Prefix match — handles "qwen2" → "qwen2.5:7b" (same major version
    //    still installed).
    const stem = requested.split(":")[0].toLowerCase();
    const prefix = tags.find((m) => m.name.toLowerCase().startsWith(stem));
    if (prefix) return prefix.name;

    // 2b. Family match — strip trailing version digits so cross-version
    //     migrations work: "qwen2" → "qwen3:0.6b", "llama3.2" → "llama3.1:8b".
    //     Exclude embedders so a stale "qwen2" never snaps to nomic-embed.
    const family = stem.replace(/[\d.]+$/, "");
    if (family && family.length >= 3 && family !== stem) {
      const familyMatch = tags.find(
        (m) =>
          m.name.toLowerCase().startsWith(family) &&
          m.details?.family !== "bert" &&
          m.details?.family !== "nomic-bert" &&
          !m.name.toLowerCase().includes("embed"),
      );
      if (familyMatch) return familyMatch.name;
    }

    // 3. First non-embedder installed model.
    const nonEmbedder = tags.find(
      (m) =>
        m.details?.family !== "bert" &&
        m.details?.family !== "nomic-bert" &&
        !m.name.toLowerCase().includes("embed"),
    );
    if (nonEmbedder) return nonEmbedder.name;

    // 4. Last resort.
    return tags[0].name;
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
  const requested = model ?? process.env.OLLAMA_MODEL ?? "qwen3:8b";
  const selectedModel = await resolveInstalledModel(requested);
  // Ollama is OpenAI-compatible, so `prepared.system` will be null and
  // `prepared.messages` carries role:"system". Using prepareForModel
  // keeps this route identically shaped to the free-tier + Agent-GO
  // paths and makes future-adapter additions (Claude, Gemini) a matter
  // of updating the helper, not the call sites.
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

      const ollamaUrl = resolveProviderUrl("ollama");
      const res = await fetch(`${ollamaUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: selectedModel,
          messages: finalMessages.map((m) => ({ role: m.role, content: m.content })),
          stream: true,
          keep_alive: "5m",
        }),
        signal: req.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`Ollama ${res.status}: ${await res.text().catch(() => "")}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (!isAborted) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // Ollama emits one JSON object per newline.
        let newlineIdx;
        while ((newlineIdx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newlineIdx).trim();
          buffer = buffer.slice(newlineIdx + 1);
          if (!line) continue;
          let chunk: OllamaChunk;
          try {
            chunk = JSON.parse(line);
          } catch {
            continue;
          }
          const content = chunk.message?.content;
          if (content) {
            fullText += content;
            const evt = createEvent<TextMessageContent>("TextMessageContent", thread, {
              runId,
              messageId,
              delta: content,
            });
            saveEvent(evt);
            hub.publish(thread, evt);
            await writeSSE(evt);
          }
          if (chunk.done) {
            inputTokens = chunk.prompt_eval_count ?? 0;
            outputTokens = chunk.eval_count ?? 0;
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
