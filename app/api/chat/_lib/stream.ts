/**
 * SSE response plumbing for POST /api/chat.
 *
 * One TransformStream per request: the proxy loop writes AG-UI events
 * framed by the shared keystone (`lib/agui/sse.ts` — `event:` + `data:` +
 * blank line), a heartbeat keeps the socket alive through long tool calls
 * that emit no events (proxies cull idle connections; comment frames are
 * ignored by every consumer), and an abort flag short-circuits writes once
 * the client goes away.
 */

import {
  encodeSSE,
  encodeHeartbeat,
  sseHeaders,
  HEARTBEAT_MS,
} from "@/lib/agui/sse";
import type { AGUIEvent } from "@/lib/agui/events";

export class ChatSSEStream {
  readonly readable: ReadableStream;
  private readonly writer: WritableStreamDefaultWriter<Uint8Array>;
  private readonly encoder = new TextEncoder();
  private readonly heartbeat: ReturnType<typeof setInterval>;
  private aborted = false;

  constructor(signal?: AbortSignal) {
    const stream = new TransformStream();
    this.readable = stream.readable;
    this.writer = stream.writable.getWriter();

    signal?.addEventListener("abort", () => {
      this.aborted = true;
    });

    this.heartbeat = setInterval(() => {
      if (this.aborted) return;
      this.writer.write(this.encoder.encode(encodeHeartbeat())).catch(() => {
        /* stream already closing; close() clears this interval */
      });
    }, HEARTBEAT_MS);
  }

  get isAborted(): boolean {
    return this.aborted;
  }

  /** Write one AG-UI event to the response stream, framed by the keystone. */
  async write(event: AGUIEvent): Promise<boolean> {
    if (this.aborted) return false;
    try {
      await this.writer.write(this.encoder.encode(encodeSSE(event)));
      return true;
    } catch (err) {
      console.error("[Chat] Stream write failed:", err);
      this.aborted = true;
      return false;
    }
  }

  /** Stop the heartbeat and close the underlying writer. Never throws. */
  async close(): Promise<void> {
    clearInterval(this.heartbeat);
    await this.writer.close().catch((err) =>
      console.warn("[Chat] writer.close failed:", err)
    );
  }
}

export interface ChatStreamIds {
  threadId: string;
  runId: string;
  messageId: string;
}

/**
 * Build the streaming Response with the deck's SSE headers plus the
 * run-scoped ids the client reads back (and CORS-exposes for the voice
 * bridge's cross-origin fetch).
 */
export function createSSEResponse(stream: ChatSSEStream, ids: ChatStreamIds): Response {
  return new Response(stream.readable, {
    headers: {
      ...sseHeaders(),
      "X-Thread-Id": ids.threadId,
      "X-Run-Id": ids.runId,
      "X-Message-Id": ids.messageId,
      "Access-Control-Expose-Headers": "X-Thread-Id, X-Run-Id, X-Message-Id",
    },
  });
}
