import { NextRequest } from "next/server";

import { ensureArbiterBooted } from "@/lib/resource/arbiter";
import { subscribe } from "@/lib/resource/ledger";
import type { ResourceEvent } from "@/lib/resource/types";
import { encodeHeartbeat, sseHeaders } from "@/lib/agui/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/resource/events
 *
 * Server-Sent Events stream of arbiter + ledger events:
 *   - ledger           (periodic snapshot push)
 *   - acquire-granted / acquire-denied / acquire-queued
 *   - evict-start / evict-done / evict-failed
 *   - release / restore-scheduled / oom
 *
 * Each event arrives as `event: <kind>\ndata: <json>\n\n`. The
 * subscriber receives the current snapshot as a `ledger` event on
 * connect so the UI paints immediately.
 */
export async function GET(_req: NextRequest): Promise<Response> {
  ensureArbiterBooted();
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(": ready\n\n"));

      const unsubscribe = subscribe((event: ResourceEvent) => {
        try {
          const data = `event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(data));
        } catch {
          /* controller closed */
        }
      });

      // Periodic heartbeat so idle connections don't get culled by
      // intermediaries (route-specific 25s cadence; keystone comment frame).
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(encodeHeartbeat()));
        } catch {
          clearInterval(heartbeat);
          unsubscribe();
        }
      }, 25_000);

      const originalCancel = controller.close.bind(controller);
      controller.close = () => {
        clearInterval(heartbeat);
        unsubscribe();
        originalCancel();
      };
    },
  });

  return new Response(stream, { headers: sseHeaders() });
}
