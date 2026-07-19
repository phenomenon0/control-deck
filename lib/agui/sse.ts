/**
 * lib/agui/sse.ts — the ONE SSE wire format for AG-UI events (Phase 3, T7).
 *
 * Canon: every server route that streams AG-UI events frames them with
 * `encodeSSE`; every client consumer parses with `SSEParser`. Frame format:
 *
 *   event: <AGUIEventType>\n
 *   data: <json>\n
 *   \n
 *
 * Heartbeats are comment frames (`: hb\n\n`) every HEARTBEAT_MS — proxies and
 * browsers keep the connection open; parsers MUST ignore comment frames.
 * No `id:` lines, no `retry:` hints, no per-route framing drift.
 *
 * Incoming frames are normalized through `normalizeEvent` so v1 senders and
 * deck extensions keep working — the parser is the single choke point where
 * schema drift is absorbed.
 */

import {
  normalizeEvent,
  type AGUIEvent,
} from "@/lib/agui/events";

export const HEARTBEAT_MS = 15_000;

/** Standard response headers for an AG-UI SSE stream. */
export function sseHeaders(): Record<string, string> {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  };
}

/** Server side: frame one event. */
export function encodeSSE(event: AGUIEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** Server side: a heartbeat comment frame. */
export function encodeHeartbeat(): string {
  return ": hb\n\n";
}

/**
 * Client side: incremental parser. Feed raw stream chunks; get back every
 * complete event since the last feed. Tolerant of chunk-split frames,
 * CRLF, comment/heartbeat frames, and multi-line boundaries.
 */
export class SSEParser {
  private buffer = "";

  feed(chunk: string): AGUIEvent[] {
    this.buffer += chunk.replace(/\r\n/g, "\n");
    const out: AGUIEvent[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf("\n\n")) !== -1) {
      const frame = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      const event = parseFrame(frame);
      if (event) out.push(event);
    }
    return out;
  }

  /** Call at stream end; flushes any trailing frame without a blank line. */
  flush(): AGUIEvent[] {
    const rest = this.buffer.trim();
    this.buffer = "";
    if (!rest) return [];
    const event = parseFrame(rest);
    return event ? [event] : [];
  }
}

function parseFrame(frame: string): AGUIEvent | null {
  let data = "";
  for (const line of frame.split("\n")) {
    if (line.startsWith(":")) return null; // comment / heartbeat
    if (line.startsWith("data:")) data += (data ? "\n" : "") + line.slice(5).trimStart();
  }
  if (!data) return null;
  try {
    return normalizeEvent(JSON.parse(data));
  } catch {
    return null; // malformed frame — skip, never crash the stream consumer
  }
}

/**
 * BLESSED NON-AG-UI SSE ROUTES (decision record, 2026-07-18)
 *
 * Four routes intentionally stream non-AG-UI payload frames while sharing
 * this module's keystone framing (sseHeaders) and heartbeat comment frames.
 * They are BLESSED as named contracts — do NOT "fix" them into AG-UI
 * events, and do NOT feed them to SSEParser: it ignores `event:` lines and
 * does no validation, so their payloads would surface as bogus AGUIEvent
 * objects (no type/timestamp/threadId) instead of parse errors. Each route
 * file carries the full frame contract in its header comment.
 *
 *   1. app/api/workspace/commands  — "workspace-command-relay"
 *      `event: workspace-command`, data: WorkspaceCommand. Server→client
 *      Dockview command channel; no threadId/runId, not agent telemetry.
 *
 *   2. app/api/resource/events     — "resource-arbiter-events"
 *      `event: <ResourceEvent.kind>`, data: ResourceEvent. Arbiter/ledger
 *      fleet state for ResourcePane; fires outside any agent run.
 *      FLAGGED: oom / evict-failed / acquire-denied overlap WarningRaised
 *      semantics — a future pass may dual-publish those as WarningRaised
 *      { source: "resource.arbiter" }, but the stream itself stays blessed
 *      (ledger snapshots + acquire/evict lifecycle have no run to key on).
 *
 *   3. app/api/code/stream         — "code-exec-stream"
 *      `event: chunk|result|done|error`. One-shot RPC-over-SSE for code
 *      execution; short-lived (maxDuration 60s, no heartbeats), no run
 *      ledger. runId/threadId are artifact-correlation passthroughs only.
 *
 *   4. app/api/onboarding/run      — "onboarding-steps"
 *      default-named `data: <Step>` frames + terminal `event: end`.
 *      First-run wizard progress under a single-user mutex; not an agent
 *      run, nothing to normalize.
 *
 * scripts/contract-check.ts should treat this set as the allowed
 * non-AG-UI SSE routes; any NEW non-AG-UI SSE route needs a blessing
 * entry here + a header comment before it merges.
 */
