import { hub } from "@/lib/agui/hub";
import type { AGUIEvent } from "@/lib/agui/events";
import {
  encodeSSE,
  encodeHeartbeat,
  sseHeaders,
  HEARTBEAT_MS,
} from "@/lib/agui/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/agui/stream — the deck's AG-UI event firehose.
 *
 * Frames follow the one wire format (lib/agui/sse.ts):
 *   event: <type>\ndata: <json>\n\n   — one per hub event
 *   : hb\n\n                          — heartbeat every HEARTBEAT_MS
 *
 * The first frame is a `Connected` handshake: a deck transport event, not a
 * run event, so it lives outside the AGUIEvent union. It is framed with the
 * same encodeSSE so consumers need only one parser; SSEParser passes
 * unknown types through untouched.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const threadId = url.searchParams.get("threadId");

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (frame: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(frame));
        } catch {
          closed = true;
        }
      };

      // Subscribe to specific thread or all events. Pass req.signal so the
      // hub auto-removes the listener if the SSE consumer disconnects —
      // avoids leaks when the client drops without a clean unsubscribe.
      const sendEvent = (evt: AGUIEvent) => send(encodeSSE(evt));
      const unsubscribe = threadId
        ? hub.subscribe(threadId, sendEvent, { signal: req.signal })
        : hub.subscribeAll(sendEvent, { signal: req.signal });

      // Initial connection handshake (see docstring — ad-hoc type, cast to
      // satisfy encodeSSE's AGUIEvent parameter).
      send(
        encodeSSE({
          type: "Connected",
          timestamp: new Date().toISOString(),
        } as unknown as AGUIEvent)
      );

      // Heartbeat so idle connections survive proxies and laptop sleep.
      const heartbeat = setInterval(() => send(encodeHeartbeat()), HEARTBEAT_MS);

      // Close the controller on disconnect; the hub already cleaned up via signal.
      req.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
    },
  });

  return new Response(stream, { headers: sseHeaders() });
}
