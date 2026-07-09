type FinishReason = "stop" | "length" | "tool_calls" | "content_filter" | "function_call";

interface ChatCompletionChunkChoice {
  index: number;
  delta: { role?: "assistant"; content?: string };
  finish_reason: FinishReason | null;
}

interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: ChatCompletionChunkChoice[];
}

interface AguiEvent {
  type?: string;
  delta?: unknown;
  toolName?: unknown;
  approved?: unknown;
  error?: { message?: unknown; code?: unknown };
  data?: {
    toolName?: unknown;
    decision?: unknown;
    reason?: unknown;
  };
}

export interface TranscodeAguiToOpenAIOptions {
  id: string;
  model: string;
  keepAliveMs?: number;
  signal?: AbortSignal;
  onFinish?: (text: string) => void | Promise<void>;
  onAbort?: () => void | Promise<void>;
  onClose?: () => void;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function frame(payload: ChatCompletionChunk): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export function contentChunk(id: string, model: string, text: string): string {
  return frame({
    id,
    object: "chat.completion.chunk",
    created: nowSeconds(),
    model,
    choices: [
      {
        index: 0,
        delta: { content: text },
        finish_reason: null,
      },
    ],
  });
}

export function keepAliveChunk(id: string, model: string): string {
  return contentChunk(id, model, " ");
}

export function finishChunk(id: string, model: string, reason: FinishReason): string {
  return frame({
    id,
    object: "chat.completion.chunk",
    created: nowSeconds(),
    model,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: reason,
      },
    ],
  });
}

export function doneFrame(): string {
  return "data: [DONE]\n\n";
}

function safeJsonParse(data: string): AguiEvent | null {
  try {
    const parsed = JSON.parse(data) as unknown;
    return parsed && typeof parsed === "object" ? parsed as AguiEvent : null;
  } catch {
    return null;
  }
}

function isUserAbortEvent(event: AguiEvent): boolean {
  const message = typeof event.error?.message === "string" ? event.error.message.toLowerCase() : "";
  const code = typeof event.error?.code === "string" ? event.error.code.toLowerCase() : "";
  return message === "aborted" || message.includes("abort") || code.includes("abort");
}

function spokenToolName(event: AguiEvent): string {
  const toolName = typeof event.toolName === "string"
    ? event.toolName
    : typeof event.data?.toolName === "string"
      ? event.data.toolName
      : "that tool";
  return toolName;
}

export function transcodeAguiToOpenAI(
  body: ReadableStream<Uint8Array>,
  opts: TranscodeAguiToOpenAIOptions,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const keepAliveMs = opts.keepAliveMs ?? 5000;

  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  let buffer = "";
  let accumulatedText = "";
  let closed = false;
  let aborted = false;
  let closeNotified = false;
  let cleanupStream = () => {};
  let notifyCloseStream = () => {};

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const cleanup = () => {
        if (keepAliveTimer) {
          clearInterval(keepAliveTimer);
          keepAliveTimer = null;
        }
        if (opts.signal) {
          opts.signal.removeEventListener("abort", handleAbort);
        }
      };
      cleanupStream = cleanup;

      const notifyClose = () => {
        if (closeNotified) return;
        closeNotified = true;
        opts.onClose?.();
      };
      notifyCloseStream = notifyClose;

      const close = () => {
        if (closed) return;
        closed = true;
        cleanup();
        notifyClose();
        try {
          controller.close();
        } catch {
          // Already closed by the consumer.
        }
      };

      const enqueue = (chunk: string) => {
        if (closed || aborted) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
          cleanup();
          notifyClose();
        }
      };

      const resetKeepAlive = () => {
        if (!Number.isFinite(keepAliveMs) || keepAliveMs <= 0 || closed || aborted) return;
        if (keepAliveTimer) clearInterval(keepAliveTimer);
        keepAliveTimer = setInterval(() => {
          enqueue(keepAliveChunk(opts.id, opts.model));
        }, keepAliveMs);
      };

      const emitTerminal = async () => {
        if (closed || aborted) return;
        try {
          await opts.onFinish?.(accumulatedText);
        } catch (err) {
          console.warn("[agent-bridge] failed to persist assistant message:", err);
        }
        enqueue(finishChunk(opts.id, opts.model, "stop"));
        enqueue(doneFrame());
        close();
      };

      const emitErrorTerminal = () => {
        if (closed || aborted) return;
        enqueue(contentChunk(opts.id, opts.model, "I hit an agent error. Please check the deck. "));
        enqueue(finishChunk(opts.id, opts.model, "stop"));
        enqueue(doneFrame());
        close();
      };

      const handleAbort = () => {
        if (aborted) return;
        aborted = true;
        void opts.onAbort?.();
        cleanup();
        void reader?.cancel("aborted").catch(() => {});
        close();
      };

      const handleData = async (data: string) => {
        if (!data || data === "[DONE]" || closed || aborted) return;
        const event = safeJsonParse(data);
        if (!event?.type) return;

        resetKeepAlive();

        switch (event.type) {
          case "TextMessageContent": {
            const delta = typeof event.delta === "string" ? event.delta : "";
            if (delta) {
              accumulatedText += delta;
              enqueue(contentChunk(opts.id, opts.model, delta));
            }
            break;
          }
          case "ToolCallStart":
            break;
          case "InterruptRequested":
            enqueue(contentChunk(
              opts.id,
              opts.model,
              `I need your approval to run ${spokenToolName(event)} — check the deck, or say confirm. `,
            ));
            break;
          case "InterruptResolved": {
            const approved = typeof event.approved === "boolean"
              ? event.approved
              : event.data?.decision === "approved";
            if (!approved) {
              enqueue(contentChunk(opts.id, opts.model, "Okay, I won't run that. "));
            }
            break;
          }
          case "RunFinished":
            await emitTerminal();
            break;
          case "RunError":
            if (isUserAbortEvent(event)) {
              aborted = true;
              close();
            } else {
              emitErrorTerminal();
            }
            break;
        }
      };

      const processLine = async (line: string) => {
        const normalized = line.endsWith("\r") ? line.slice(0, -1) : line;
        if (!normalized.startsWith("data:")) return;
        await handleData(normalized.slice(5).trim());
      };

      resetKeepAlive();

      if (opts.signal) {
        if (opts.signal.aborted) {
          handleAbort();
          return;
        }
        opts.signal.addEventListener("abort", handleAbort, { once: true });
      }

      reader = body.getReader();

      void (async () => {
        try {
          while (!closed && !aborted) {
            const { done, value } = await reader!.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              await processLine(line);
              if (closed || aborted) break;
            }
          }

          if (!closed && !aborted) {
            buffer += decoder.decode();
            if (buffer) await processLine(buffer);
          }

          if (!closed && !aborted) {
            emitErrorTerminal();
          }
        } catch {
          if (!closed && !aborted) emitErrorTerminal();
        } finally {
          try {
            reader?.releaseLock();
          } catch {
            // The lock may already have been released after cancellation.
          }
          if (aborted && !closed) close();
        }
      })();
    },
    cancel(reason) {
      aborted = true;
      cleanupStream();
      notifyCloseStream();
      void opts.onAbort?.();
      void reader?.cancel(reason).catch(() => {});
    },
  });
}
