import { NextRequest } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

import { HEARTBEAT_MS, encodeHeartbeat, sseHeaders } from "@/lib/agui/sse";
import { NODECTL, nodectlProblem, runNodectl } from "./nodectl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/fleet
 *
 * Server-Sent Events stream of the ipad-lab fleet's live state, for the
 * FleetPane. Every POLL_MS the route shells out to `nodectl --json` for the
 * whole fleet and pushes one merged snapshot:
 *
 *   fleet ls           -> per-node reachability (host, up/DOWN, rtt, clock offset)
 *   mesh anchor        -> anchor election + split-brain detection (agree flag)
 *   mesh peers         -> each live node's peer list, incl. advertised capabilities
 *   sensors --on all   -> latest sensor snapshot per node
 *   fleet call viz.status -> nodebootstrap's view: heartbeat, SAFE MODE, uptime
 *   wall stats         -> what each renderer is actually DRAWING (frames, fps)
 *   wall ls            -> the wall layout: grid, per-cell rect, who sits where
 *
 * viz.status and wall stats exist because everything else here can be green
 * while a pad's screen is dead. viz.status.safe_mode is set after 3 renderer crashes in 60s,
 * at which point nodebootstrap stops relaunching -- the node then answers every
 * other check perfectly and shows nothing. And a renderer whose draw loop has
 * stalled still holds its TCP port and still answers `ping`, so only the frame
 * counter behind `wall stats` can tell "the node is up" from "the screen is on".
 * (viz.status.renderer_pid is NOT that signal: ipad-d and ipad-e report null for
 * it while demonstrably drawing at 51 fps.)
 *
 * plus two host-side activity notes read straight off disk (no device I/O):
 * the last scene nodectl pushed and the last scheduled fleet-smoke verdict.
 *
 * All but `wall ls` open TCP to every seed host. An unreachable
 * node costs a full connect timeout, and unreachable is a NORMAL fleet state,
 * not a fault: a node away in a bounded mesh session is deliberately off the
 * LAN and coming back on its own, and a node with no infrastructure association
 * has no door at all. The calls run in parallel, then the route waits
 * POLL_MS before the next cycle — a deliberately modest cadence, because this
 * talks to embedded hardware over a radio link, not a database.
 *
 * NON-AG-UI SSE CONTRACT — "fleet-state-events". Like the resource-arbiter and
 * workspace-command streams, this shares the keystone framing (sseHeaders +
 * heartbeat comment frames) but carries a non-AG-UI payload: it is fleet
 * hardware telemetry, not per-run agent events, so it must NOT be fed to
 * SSEParser. Frames:
 *   `: ready\n\n`                      — kickoff comment (proxy flush)
 *   `event: fleet`, data: FleetSnapshot — one merged fleet snapshot per poll
 *   `: hb\n\n`                         — heartbeat comment, 15s cadence
 */

/**
 * Where the fleet tooling drops its host-side activity notes. Derived from
 * NODECTL (<repo>/bin/nodectl -> <repo>/logs) so a checkout override moves both
 * together; overridable on its own for an unusual layout.
 */
const FLEET_LOGS =
  process.env.FLEET_LOGS ?? path.resolve(path.dirname(NODECTL), "..", "logs");

// A poll's CLI calls run in parallel (~5s wall when nodes are down); this
// is the idle gap AFTER a snapshot ships before the next cycle starts. Raised
// from 4s when the last two calls were added: each one is another TCP fan-out
// to all four pads, two of which run on battery, so the gap grew with the
// payload to keep device I/O per minute roughly flat while carrying more.
// (`wall ls` was added at the same time and is free: it reads fleet.json and
// wall.json only, opening no socket to any device.)
const POLL_MS = 6_000;
/**
 * Read one host-side activity note. These are written by the fleet tooling, not
 * by a device: host/ops/run-smoke.sh writes fleet-smoke-last.json after every
 * scheduled run, and nodectl writes fleet-scene-last.json on every scene push
 * (the renderer reports only a scene_version counter, so the host is the only
 * thing that knows which scene is up). A missing file means "never run", which
 * is normal on a fresh checkout — not an error, so it resolves to null and the
 * pane shows its own empty state.
 */
async function readNote(name: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(path.join(FLEET_LOGS, name), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** "3m ago" / "2h ago" for a note's timestamp; notes are minutes-to-days old. */
function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 172800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/** e.g. "examples/bar_left.json · 3m ago" */
function formatScene(note: Record<string, unknown> | null): string | undefined {
  if (!note) return undefined;
  const scene = typeof note.scene === "string" ? note.scene : "<inline>";
  const name = scene.startsWith("/") ? path.basename(scene) : scene;
  // nodectl writes seconds (time.time()), not milliseconds.
  const ts = typeof note.ts === "number" ? ` · ${ago(note.ts * 1000)}` : "";
  return `${name}${ts}`;
}

/**
 * e.g. "4/4 PASS · 12m ago" or "3/4 FAIL: ipad-c · 12m ago".
 *
 * run-smoke.sh wraps nodectl's payload as {ts, rc, ok, result}, and writes a
 * result even when the run crashed — so trust `rc`/`ok` from the wrapper and
 * treat a payload with no device list as a failed run, never as a silent pass.
 */
function formatSmoke(note: Record<string, unknown> | null): string | undefined {
  if (!note) return undefined;
  const when = typeof note.ts === "string" ? ` · ${ago(Date.parse(note.ts))}` : "";
  const result = note.result as
    | { passed?: number; total?: number; devices?: Array<{ id?: string; ok?: boolean }> }
    | undefined;
  const devices = Array.isArray(result?.devices) ? result!.devices! : null;
  if (!devices) return `no result parsed (rc ${note.rc ?? "?"})${when}`;
  const failed = devices.filter((d) => !d.ok).map((d) => d.id ?? "?");
  const verdict = failed.length === 0 ? "PASS" : `FAIL: ${failed.join(", ")}`;
  // run-smoke.sh records the nodes it skipped (no door on the LAN) precisely so
  // a green badge cannot be read as "the whole fleet" when it was a subset.
  const notCovered = Array.isArray(note.not_covered) ? note.not_covered.filter(Boolean) : [];
  const skipped = notCovered.length ? ` · untested: ${notCovered.join(", ")}` : "";
  return `${result?.passed ?? devices.length - failed.length}/${result?.total ?? devices.length} ${verdict}${skipped}${when}`;
}

/** Gather every source in parallel and merge into one snapshot for the pane. */
async function collectSnapshot(): Promise<Record<string, unknown>> {
  const [roster, anchor, peers, sensors, status, render, layout, sceneNote, smokeNote] =
    await Promise.all([
      runNodectl(["fleet", "ls"]),
      runNodectl(["mesh", "anchor"]),
      runNodectl(["mesh", "peers"]),
      runNodectl(["sensors", "--on", "all"]),
      runNodectl(["fleet", "call", "viz.status", "--on", "all"]),
      runNodectl(["wall", "stats"]),
      runNodectl(["wall", "ls"]),
      readNote("fleet-scene-last.json"),
      readNote("fleet-smoke-last.json"),
    ]);
  return {
    ts: Date.now(),
    roster: roster.json,
    rosterError: roster.error,
    anchor: anchor.json,
    anchorError: anchor.error,
    peers: peers.json,
    peersError: peers.error,
    sensors: sensors.json,
    sensorsError: sensors.error,
    status: status.json,
    statusError: status.error,
    render: render.json,
    renderError: render.error,
    layout: layout.json,
    layoutError: layout.error,
    lastScene: formatScene(sceneNote),
    lastSmoke: formatSmoke(smokeNote),
  };
}

export async function GET(req: NextRequest): Promise<Response> {
  // ?once=1 — one snapshot as plain JSON, then close. The SSE stream above is
  // right for a pane that stays open; it is the wrong shape for the GNOME
  // panel widget, which wakes every 10s and would otherwise need a GJS SSE
  // client with its own reconnect logic to read a feed it does not keep.
  // Same collector, same snapshot, so both surfaces agree by construction.
  if (req.nextUrl.searchParams.get("once")) {
    const problem = await nodectlProblem();
    const body = problem
      ? { ts: Date.now(), configError: problem }
      : await collectSnapshot();
    return new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(": ready\n\n"));

      // Heartbeat comment so idle connections survive intermediaries; matches
      // the 15s cadence used by the other blessed non-AG-UI streams.
      const heartbeat = setInterval(() => {
        // Self-clearing: the poll loop is not the only path that stops. A
        // config error returns early and never reaches its clearInterval, and
        // cancel() cannot see this handle at all.
        if (closed) {
          clearInterval(heartbeat);
          return;
        }
        try {
          controller.enqueue(encoder.encode(encodeHeartbeat()));
        } catch {
          closed = true;
          clearInterval(heartbeat);
        }
      }, HEARTBEAT_MS);

      // Poll loop: snapshot, ship, idle POLL_MS, repeat until the client
      // disconnects. Runs immediately so the pane paints on the first cycle.
      void (async () => {
        // Loud, once, and then stop: polling a CLI that does not exist would
        // just repaint the same misleading failure every 4 seconds.
        const problem = await nodectlProblem();
        if (problem) {
          try {
            controller.enqueue(
              encoder.encode(
                `event: fleet\ndata: ${JSON.stringify({
                  ts: Date.now(),
                  configError: problem,
                })}\n\n`,
              ),
            );
          } catch {
            /* client already gone */
          }
          return; // heartbeat keeps the stream open; nothing left to poll
        }
        while (!closed) {
          let snapshot: Record<string, unknown>;
          try {
            snapshot = await collectSnapshot();
          } catch (err) {
            snapshot = {
              ts: Date.now(),
              error: err instanceof Error ? err.message : String(err),
            };
          }
          if (closed) break;
          try {
            controller.enqueue(
              encoder.encode(`event: fleet\ndata: ${JSON.stringify(snapshot)}\n\n`),
            );
          } catch {
            break; // controller closed under us
          }
          await new Promise((r) => setTimeout(r, POLL_MS));
        }
        clearInterval(heartbeat);
      })();
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, { headers: sseHeaders() });
}
