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

      // Subscribe to specific thread or all events
      const unsubscribe = threadId
        ? hub.subscribe(threadId, send)
        : hub.subscribeAll(send);

      // Send initial connection event
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "Connected", timestamp: new Date().toISOString() })}\n\n`)
      );

      // Handle client disconnect
      req.signal.addEventListener("abort", () => {
        unsubscribe();
        controller.close();
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
