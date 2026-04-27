import { hub } from "@/lib/agui/hub";
import type { AGUIEvent } from "@/lib/agui/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const threadId = url.searchParams.get("threadId");

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (evt: AGUIEvent) => {
        const data = `data: ${JSON.stringify(evt)}\n\n`;
        controller.enqueue(encoder.encode(data));
      };

      // Subscribe to specific thread or all events. Pass req.signal so the
      // hub auto-removes the listener if the SSE consumer disconnects —
      // avoids leaks when the client drops without a clean unsubscribe.
      const unsubscribe = threadId
        ? hub.subscribe(threadId, send, { signal: req.signal })
        : hub.subscribeAll(send, { signal: req.signal });

      // Send initial connection event
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "Connected", timestamp: new Date().toISOString() })}\n\n`)
      );

      // Close the controller on disconnect; the hub already cleaned up via signal.
      req.signal.addEventListener("abort", () => {
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
