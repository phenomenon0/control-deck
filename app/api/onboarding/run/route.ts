// POST /api/onboarding/run — SSE stream of Step events. Body: { tier?, consents? }.
//
// BLESSED NON-AG-UI SSE CONTRACT — "onboarding-steps" (recorded in
// lib/agui/sse.ts). This is first-run wizard progress (single-user mutex
// below), not an agent run: no run ledger, no threadId/runId, nothing to
// normalize. Frames:
//   `data: <Step json>\n\n`  — DEFAULT event name (no `event:` line);
//     Step { id, title, status: "running"|"done"|"skipped"|"failed",
//            detail?, progress?: 0..1, t?: ms }  (lib/onboarding/orchestrator.ts)
//   `event: end`             — data: {} (terminal success marker)
//   `: hb\n\n`               — heartbeat comment, HEARTBEAT_MS cadence

import { runOnboarding, type Consents, type Step } from "@/lib/onboarding/orchestrator";
import type { TierId } from "@/lib/inference/hardware-tiers";
import { encodeHeartbeat, sseHeaders, HEARTBEAT_MS } from "@/lib/agui/sse";

export const dynamic = "force-dynamic";

interface RunBody {
  tier?: TierId;
  consents?: Consents;
}

// Single-user mutex: parallel runs would double-prompt sudo and double-pull models.
let runInFlight = false;

export async function POST(req: Request): Promise<Response> {
  if (runInFlight) {
    return Response.json(
      {
        error: "onboarding_in_progress",
        message:
          "Onboarding is already running in another tab. Wait for it to finish, or refresh that tab.",
      },
      { status: 409 },
    );
  }
  runInFlight = true;
  let body: RunBody = {};
  try {
    body = (await req.json()) as RunBody;
  } catch {
    /* empty body is fine */
  }

  const encoder = new TextEncoder();
  // Hoisted so cancel() can flip them. `closed` gates further enqueues; the
  // AbortController is the real cancel signal threaded into the orchestrator.
  let closed = false;
  const abortController = new AbortController();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const safeEnqueue = (bytes: Uint8Array) => {
        if (closed) return;
        try { controller.enqueue(bytes); } catch { closed = true; }
      };
      const emit = (step: Step) => {
        safeEnqueue(encoder.encode(`data: ${JSON.stringify(step)}\n\n`));
      };
      // Heartbeat keeps proxies + laptop-sleep recoveries from dropping the socket.
      const heartbeat = setInterval(() => {
        safeEnqueue(encoder.encode(encodeHeartbeat()));
      }, HEARTBEAT_MS);
      try {
        for await (const step of runOnboarding({
          tierOverride: body.tier,
          consents: body.consents,
          signal: abortController.signal,
        })) {
          emit(step);
          if (closed) break;
        }
        safeEnqueue(encoder.encode("event: end\ndata: {}\n\n"));
      } catch (err) {
        emit({
          id: "fatal",
          title: "Onboarding crashed",
          status: "failed",
          detail: err instanceof Error ? err.message : String(err),
        });
      } finally {
        clearInterval(heartbeat);
        closed = true;
        runInFlight = false;
        try { controller.close(); } catch { /* already closed */ }
      }
    },
    // Client disconnect — abort the generator so spawned children get killed
    // and the mutex releases promptly. Without this, a 30-min pull stays
    // running and blocks retries until it finishes naturally.
    cancel() {
      closed = true;
      try { abortController.abort(); } catch { /* already aborted */ }
    },
  });

  return new Response(stream, { headers: sseHeaders() });
}
