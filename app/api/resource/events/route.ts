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
 *
 * BLESSED NON-AG-UI SSE CONTRACT — "resource-arbiter-events"
 * (recorded in lib/agui/sse.ts). This is fleet/arbiter state sync for
 * the ResourcePane, not per-run agent telemetry: ResourceEvent
 * (lib/resource/types.ts) has no threadId/runId and fires outside any
 * agent run. Frames:
 *   `: ready\n\n`                — kickoff comment (proxy flush)
 *   `event: <ResourceEvent.kind>` — data: the ResourceEvent variant;
 *     kinds: ledger | acquire-granted | acquire-denied | acquire-queued
 *          | evict-start | evict-done | evict-failed | release
 *          | restore-scheduled | downgrade-swap | oom
 *   `: hb\n\n`                   — heartbeat comment, 25s cadence
 *
 * FLAGGED (not migrated): `oom`, `evict-failed`, and `acquire-denied`
 * semantically overlap AG-UI `WarningRaised` — a future pass could
 * dual-publish those three as WarningRaised { source: "resource.arbiter" }
 * so run timelines see resource faults. The stream itself stays blessed:
 * ledger snapshots and acquire/evict lifecycle have no run to key on.
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
