/**
 * POST /api/chat/free — Free-tier roulette chat route.
 *
 * Picks the next available free-tier model via `freeTierRouter`, streams
 * the response from OpenRouter as AGUI events (same contract as
 * `/api/chat/simple`), and retries with the next free model on 429.
 *
 * Requires OPENROUTER_API_KEY. Free-tier routing is OFF by default — this
 * route is only hit when `prefs.freeMode` is on OR the user explicitly
 * posts here.
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
import { freeTierRouter, type Pick, type FreeTierModel } from "@/lib/llm/freeTier";
import { augmentForModel, withSystemPrompt } from "@/lib/llm/systemPrompt";

interface ProviderCall {
  url: string;
  headers: Record<string, string>;
}

/**
 * Map a free-tier model to the provider-specific endpoint + auth headers.
 * OpenRouter and NVIDIA NIM are both OpenAI-compatible so the request body
 * is identical across them.
 */
function providerCall(model: FreeTierModel): ProviderCall | { error: string; status: number } {
  switch (model.provider) {
    case "openrouter": {
      const key = process.env.OPENROUTER_API_KEY;
      if (!key) return { error: "OPENROUTER_API_KEY not set", status: 501 };
      return {
        url: "https://openrouter.ai/api/v1/chat/completions",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
          "HTTP-Referer": "http://localhost:3333",
          "X-Title": "Control Deck",
        },
      };
    }
    case "nvidia": {
      const key = process.env.NVIDIA_API_KEY;
      if (!key) return { error: "NVIDIA_API_KEY not set", status: 501 };
      return {
        url: "https://integrate.api.nvidia.com/v1/chat/completions",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
      };
    }
  }
}

interface FreeChatBody {
  messages?: Array<{ role: string; content: string }>;
  threadId?: string;
  needsMultimodal?: boolean;
  /**
   * User's remembered model choice (from prefs.model). Passed as a soft
   * preference to the router's first pick only — on 429 we let the
   * roulette walk naturally rather than re-pinning the failed choice.
   */
  preferredModel?: string;
  /** User-editable system prompt. Augmented per-model before use. */
  systemPrompt?: string;
}

interface OpenRouterChunk {
  choices?: Array<{
    delta?: { content?: string };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

const MAX_SWITCHES_PER_REQUEST = 3;

export async function POST(req: Request) {
  let body: FreeChatBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const { messages, threadId, needsMultimodal, preferredModel, systemPrompt } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "messages array required" }, { status: 400 });
  }

  // At least one provider must have its key set; otherwise there's
  // nothing to route to.
  if (!process.env.OPENROUTER_API_KEY && !process.env.NVIDIA_API_KEY) {
    return NextResponse.json(
      { error: "No free-tier provider keys set — add OPENROUTER_API_KEY and/or NVIDIA_API_KEY." },
      { status: 501 },
    );
  }

  let pick: Pick | null = freeTierRouter.pick({ needsMultimodal, preferredId: preferredModel });
  if (!pick) {
    return NextResponse.json(
      { error: "All free-tier models are currently rate-limited. Try again in a minute." },
      { status: 429 },
    );
  }

  const thread = threadId ?? generateId();
  const runId = generateId();
  const messageId = generateId();

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

  // Pre-flight: walk candidates to find one with a valid provider key.
  // This avoids emitting RunStarted with a model that will be skipped in
  // the loop, which would leave the UI showing the wrong active model.
  const skippedForMissingKey = new Set<string>();
  while (pick && "error" in providerCall(pick.model)) {
    skippedForMissingKey.add(pick.model.id);
    const next = freeTierRouter.pick({ needsMultimodal, excludeIds: skippedForMissingKey });
    if (!next) {
      return NextResponse.json(
        { error: "No free-tier provider has a valid API key for the models in the catalog." },
        { status: 501 },
      );
    }
    pick = next;
  }
  if (!pick) {
    return NextResponse.json({ error: "free-tier router ran out of candidates" }, { status: 500 });
  }

  const runStarted = createEvent<RunStarted>("RunStarted", thread, {
    runId,
    model: pick.model.id,
    input: jsonPayload(messages[messages.length - 1]?.content ?? ""),
  });
  createRun(runId, thread, pick.model.id);
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
    let switches = 0;

    try {
      await writeSSE(runStarted);
      await writeSSE(msgStart);

      while (true) {
        if (!pick) throw new Error("free-tier router ran out of candidates");

        console.log(`[Free] attempt via ${pick.model.provider}:${pick.model.id}${pick.switched ? ` (switched from ${pick.previous})` : ""}`);

        // Pre-flight already ensured the provider key exists for this
        // model; narrow the return type via a non-null assertion shape.
        const call = providerCall(pick.model);
        if ("error" in call) {
          // Defensive: can only happen if the catalog was refreshed mid-
          // request. Skip and try next.
          skippedForMissingKey.add(pick.model.id);
          const next = freeTierRouter.pick({ needsMultimodal, excludeIds: skippedForMissingKey });
          if (!next) throw new Error(`free-tier: ${call.error}`);
          pick = next;
          continue;
        }

        freeTierRouter.record(pick.model.id);

        // Per-pick augmentation — free-tier mid-request switches mean
        // the model family can change, so the language anchor must be
        // recomputed for the model we're *actually* about to hit.
        const augmentedSystem = augmentForModel(systemPrompt ?? "", pick.model.id);
        const finalMessages = withSystemPrompt(messages, augmentedSystem);
        const res = await fetch(call.url, {
          method: "POST",
          headers: call.headers,
          body: JSON.stringify({
            model: pick.model.id,
            messages: finalMessages.map((m) => ({ role: m.role, content: m.content })),
            stream: true,
          }),
          signal: req.signal,
        });

        if (res.status === 429) {
          freeTierRouter.markExhausted(pick.model.id, "429-minute");
          if (switches >= MAX_SWITCHES_PER_REQUEST) {
            throw new Error(`free-tier: exhausted ${switches} models, giving up`);
          }
          switches += 1;
          const next = freeTierRouter.pick({ needsMultimodal });
          if (!next) throw new Error("free-tier: all models rate-limited");
          console.log(`[Free] 429 from ${pick.model.id} — retrying with ${next.model.id}`);
          pick = next;
          continue;
        }

        if (!res.ok || !res.body) {
          throw new Error(`OpenRouter ${res.status}: ${await res.text().catch(() => "")}`);
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
            const line = buffer.slice(0, newlineIdx).trim();
            buffer = buffer.slice(newlineIdx + 1);
            if (!line || !line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (payload === "[DONE]") continue;
            let chunk: OpenRouterChunk;
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
        break;
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
        costUsd: 0,
      });
      finishRun(runId, inputTokens, outputTokens, 0);
      if (fullText) updateRunPreview(runId, fullText);
      saveEvent(runFinished);
      hub.publish(thread, runFinished);
      await writeSSE(runFinished);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "free-tier chat failed";
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
