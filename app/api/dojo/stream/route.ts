/**
 * AG-UI Dojo Stream API
 * SSE endpoint for real-time event streaming
 */

import { NextRequest } from "next/server";

// In-memory event hub (in production, use Redis or similar)
const eventHubs = new Map<string, Set<(event: string) => void>>();

export function emitDojoEvent(threadId: string, event: Record<string, unknown>) {
  const hub = eventHubs.get(threadId);
  if (hub) {
    const data = JSON.stringify(event);
    for (const listener of hub) {
      listener(data);
    }
  }
}

export async function GET(request: NextRequest) {
  const threadId = request.nextUrl.searchParams.get("threadId");
  
  if (!threadId) {
    return new Response("Missing threadId", { status: 400 });
  }
  
  const encoder = new TextEncoder();
  
  const stream = new ReadableStream({
    start(controller) {
      // Create hub if not exists
      if (!eventHubs.has(threadId)) {
        eventHubs.set(threadId, new Set());
      }
      
      const hub = eventHubs.get(threadId)!;
      
      // Event listener
      const listener = (data: string) => {
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };
      
      hub.add(listener);
      
      // Send initial connection event
      const connectEvent = JSON.stringify({
        type: "CONNECTED",
        threadId,
        timestamp: new Date().toISOString(),
      });
      controller.enqueue(encoder.encode(`data: ${connectEvent}\n\n`));
      
      // Heartbeat
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          clearInterval(heartbeat);
        }
      }, 30000);
      
      // Cleanup on close
      request.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        hub.delete(listener);
        if (hub.size === 0) {
          eventHubs.delete(threadId);
        }
      });
    },
  });
  
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
