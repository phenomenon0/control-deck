/**
 * POST /api/chat/cloud — paid cloud route.
 *
 * Policy: user pinned a specific { provider, model }. No fallback on
 * 429 — the user sees the error and decides. The system prompt is
 * prepared by `prepareForModel` so Anthropic's separate-system-field
 * and OpenAI o1/o3's inlined-Instructions variants are handled
 * automatically before we hit the dispatcher.
 *
 * Streams AGUI events identically to /api/chat/free and /api/chat/simple
 * so useAgentRun consumes it without branching.
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
import { prepareForModel } from "@/lib/llm/systemPrompt";
import {
  dispatchCloud,
  findProvider,
  type CloudProviderId,
} from "@/lib/llm/cloudProviders";

interface CloudChatBody {
  messages?: Array<{ role: string; content: string }>;
  threadId?: string;
  provider?: CloudProviderId;
  model?: string;
  systemPrompt?: string;
}

export async function POST(req: Request) {
  let body: CloudChatBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const { messages, threadId, provider, model, systemPrompt } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "messages array required" }, { status: 400 });
  }
  if (!provider || !model) {
    return NextResponse.json({ error: "provider and model required for cloud mode" }, { status: 400 });
  }
  const providerRecord = findProvider(provider);
  if (!providerRecord) {
    return NextResponse.json({ error: `unknown cloud provider: ${provider}` }, { status: 400 });
  }
  if (!providerRecord.implemented) {
    return NextResponse.json(
      { error: `${providerRecord.name} adapter is not yet implemented` },
      { status: 501 },
    );
  }
  if (!process.env[providerRecord.envKey]) {
    return NextResponse.json(
      { error: `${providerRecord.envKey} not set` },
      { status: 501 },
    );
  }

  const thread = threadId ?? generateId();
  const runId = generateId();
  const messageId = generateId();

  const prepared = prepareForModel(messages, systemPrompt ?? "", model);

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

  const runStarted = createEvent<RunStarted>("RunStarted", thread, {
    runId,
    model,
    input: jsonPayload(messages[messages.length - 1]?.content ?? ""),
  });
  createRun(runId, thread, model);
  saveEvent(runStarted);
  hub.publish(thread, runStarted);

  const msgStart = createEvent<TextMessageStart>("TextMessageStart", thread, {
    runId,
    messageId,
    role: "assistant",
  });
  saveEvent(msgStart);
  hub.publish(thread, msgStart);

  (async () => {
    let fullText = "";
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      await writeSSE(runStarted);
      await writeSSE(msgStart);

      const { response: res, parse } = await dispatchCloud(provider, {
        model,
        messages: prepared.messages,
        system: prepared.system,
        signal: req.signal,
      });

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "");
        throw new Error(`${providerRecord.name} ${res.status}: ${errText}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (!isAborted) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newlineIdx;
        while ((newlineIdx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newlineIdx);
          buffer = buffer.slice(newlineIdx + 1);
          const ev = parse(line.trim());
          if (!ev) continue;
          if (ev.delta) {
            fullText += ev.delta;
            const chunk = createEvent<TextMessageContent>("TextMessageContent", thread, {
              runId,
              messageId,
              delta: ev.delta,
            });
            saveEvent(chunk);
            hub.publish(thread, chunk);
            await writeSSE(chunk);
          }
          if (ev.inputTokens !== undefined) inputTokens = ev.inputTokens;
          if (ev.outputTokens !== undefined) outputTokens = ev.outputTokens;
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
        costUsd: 0, // cost calc not implemented — future work
      });
      finishRun(runId, inputTokens, outputTokens, 0);
      if (fullText) updateRunPreview(runId, fullText);
      saveEvent(runFinished);
      hub.publish(thread, runFinished);
      await writeSSE(runFinished);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "cloud chat failed";
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
