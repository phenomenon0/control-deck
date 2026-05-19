// POST /api/onboarding/run — SSE stream of Step events. Body: { tier?, consents? }.

import { runOnboarding, type Consents, type Step } from "@/lib/onboarding/orchestrator";
import type { TierId } from "@/lib/inference/hardware-tiers";

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
  // Hoisted so cancel() can flip it; the generator drops on next yield.
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const safeEnqueue = (bytes: Uint8Array) => {
        if (closed) return;
        try { controller.enqueue(bytes); } catch { closed = true; }
      };
      const emit = (step: Step) => {
        safeEnqueue(encoder.encode(`data: ${JSON.stringify(step)}\n\n`));
      };
      // 15s heartbeat keeps proxies + laptop-sleep recoveries from dropping the socket.
      const heartbeat = setInterval(() => {
        safeEnqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`));
      }, 15000);
      try {
        for await (const step of runOnboarding({ tierOverride: body.tier, consents: body.consents })) {
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
    // Mutex stays held until the generator finishes — quick cancel/retry must not double-pull.
    cancel() { closed = true; },
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
