import { describe, expect, test } from "bun:test";
import { transcodeAguiToOpenAI } from "./openai-sse";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function aguiFrame(event: object): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fakeUpstream(
  steps: Array<{ delayMs?: number; event: object }>,
  onCancel?: () => void,
): ReadableStream<Uint8Array> {
  let cancelled = false;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const step of steps) {
        if (step.delayMs) await sleep(step.delayMs);
        if (cancelled) return;
        controller.enqueue(aguiFrame(step.event));
      }
      if (!cancelled) controller.close();
    },
    cancel() {
      cancelled = true;
      onCancel?.();
    },
  });
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

function parseFrames(raw: string): Array<Record<string, unknown> | "[DONE]"> {
  return raw
    .split("\n\n")
    .map((frame) => frame.trim())
    .filter(Boolean)
    .map((frame) => frame.replace(/^data:\s*/, ""))
    .map((data) => data === "[DONE]" ? "[DONE]" : JSON.parse(data) as Record<string, unknown>);
}

function deltaContents(frames: Array<Record<string, unknown> | "[DONE]">): string[] {
  return frames.flatMap((frame) => {
    if (frame === "[DONE]") return [];
    const choices = frame.choices as Array<{ delta?: { content?: string } }> | undefined;
    const content = choices?.[0]?.delta?.content;
    return typeof content === "string" ? [content] : [];
  });
}

function finishReasons(frames: Array<Record<string, unknown> | "[DONE]">): Array<unknown> {
  return frames.flatMap((frame) => {
    if (frame === "[DONE]") return [];
    const choices = frame.choices as Array<{ finish_reason?: unknown }> | undefined;
    const reason = choices?.[0]?.finish_reason;
    return reason ? [reason] : [];
  });
}

describe("agent bridge AG-UI to OpenAI SSE transcoder", () => {
  test("emits content chunks in order", async () => {
    const stream = transcodeAguiToOpenAI(fakeUpstream([
      { event: { type: "TextMessageContent", delta: "Hello" } },
      { event: { type: "TextMessageContent", delta: " world" } },
      { event: { type: "RunFinished" } },
    ]), {
      id: "chatcmpl_test",
      model: "test-model",
      keepAliveMs: 1000,
    });

    const frames = parseFrames(await readAll(stream));
    expect(deltaContents(frames)).toEqual(["Hello", " world"]);
  });

  test("emits keep-alive chunks during an upstream silent gap", async () => {
    const stream = transcodeAguiToOpenAI(fakeUpstream([
      { event: { type: "TextMessageContent", delta: "start" } },
      { delayMs: 35, event: { type: "TextMessageContent", delta: "end" } },
      { event: { type: "RunFinished" } },
    ]), {
      id: "chatcmpl_test",
      model: "test-model",
      keepAliveMs: 10,
    });

    const frames = parseFrames(await readAll(stream));
    const contents = deltaContents(frames);
    const startIndex = contents.indexOf("start");
    const endIndex = contents.indexOf("end");

    expect(startIndex).toBeGreaterThanOrEqual(0);
    expect(endIndex).toBeGreaterThan(startIndex);
    expect(contents.slice(startIndex + 1, endIndex)).toContain(" ");
  });

  test("emits finish and DONE on RunFinished", async () => {
    const stream = transcodeAguiToOpenAI(fakeUpstream([
      { event: { type: "TextMessageContent", delta: "done" } },
      { event: { type: "RunFinished" } },
    ]), {
      id: "chatcmpl_test",
      model: "test-model",
      keepAliveMs: 1000,
    });

    const frames = parseFrames(await readAll(stream));
    expect(finishReasons(frames)).toEqual(["stop"]);
    expect(frames.at(-1)).toBe("[DONE]");
  });

  test("abort cancels the upstream reader", async () => {
    let cancelled = false;
    const body = fakeUpstream([
      { delayMs: 1000, event: { type: "TextMessageContent", delta: "late" } },
    ], () => {
      cancelled = true;
    });
    const abort = new AbortController();
    const stream = transcodeAguiToOpenAI(body, {
      id: "chatcmpl_test",
      model: "test-model",
      keepAliveMs: 1000,
      signal: abort.signal,
    });
    const reader = stream.getReader();

    await Promise.resolve();
    abort.abort();
    const result = await reader.read();

    expect(result.done).toBe(true);
    expect(cancelled).toBe(true);
  });
});
