import { NextRequest } from "next/server";
import { execFile } from "child_process";
import { access, readFile } from "fs/promises";
import { constants as FS } from "fs";
import path from "path";

import { encodeHeartbeat, sseHeaders } from "@/lib/agui/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/fleet
 *
 * Server-Sent Events stream of the ipad-lab fleet's live state, for the
 * FleetPane. Every POLL_MS the route shells out to `nodectl --json` for the
 * whole fleet and pushes one merged snapshot:
 *
 *   fleet ls          -> per-node reachability (host, up/DOWN, rtt, clock offset)
 *   mesh anchor       -> anchor election + split-brain detection (agree flag)
 *   mesh peers        -> each live node's peer list, incl. advertised capabilities
 *   sensors --on all  -> latest sensor snapshot per node
 *
 * plus two host-side activity notes read straight off disk (no device I/O):
 * the last scene nodectl pushed and the last scheduled fleet-smoke verdict.
 *
 * Each of those four CLI calls opens TCP to every seed host. An unreachable
 * node costs a full connect timeout, and unreachable is a NORMAL fleet state,
 * not a fault: a node away in a bounded mesh session is deliberately off the
 * LAN and coming back on its own, and a node with no infrastructure association
 * has no door at all. The four calls run in parallel, then the route waits
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

/** Absolute path to the ipad-lab control-plane CLI; overridable for other checkouts. */
const NODECTL =
  process.env.FLEET_NODECTL ??
  "/home/omen/Documents/Project/ipad-lab/bin/nodectl";

/**
 * Is the CLI actually there? Checked ONCE before the first poll.
 *
 * The default above is one developer's absolute path. On any other checkout
 * every execFile fails identically, and without this the pane renders four
 * separate "no output from nodectl" errors that look exactly like a fleet-wide
 * outage — the operator goes looking at the hardware for a problem that is in
 * the environment. A configuration error must announce itself as one.
 */
async function nodectlProblem(): Promise<string | null> {
  try {
    await access(NODECTL, FS.X_OK);
    return null;
  } catch {
    return (
      `nodectl is not executable at ${NODECTL} — this pane is not talking to ` +
      `the fleet at all. Set FLEET_NODECTL to your ipad-lab checkout's ` +
      `bin/nodectl (and FLEET_LOGS if its logs/ lives elsewhere).`
    );
  }
}

/**
 * Where the fleet tooling drops its host-side activity notes. Derived from
 * NODECTL (<repo>/bin/nodectl -> <repo>/logs) so a checkout override moves both
 * together; overridable on its own for an unusual layout.
 */
const FLEET_LOGS =
  process.env.FLEET_LOGS ?? path.resolve(path.dirname(NODECTL), "..", "logs");

// A poll's four CLI calls run in parallel (~5s wall when nodes are down); this
// is the idle gap AFTER a snapshot ships before the next cycle starts.
const POLL_MS = 4_000;
// Each nodectl call opens TCP to up to five hosts with its own per-host
// timeout; 25s is a generous ceiling that only trips if the CLI itself wedges.
const CMD_TIMEOUT_MS = 25_000;

interface CmdResult {
  /** Parsed JSON stdout, or null when the CLI produced no valid JSON. */
  json: unknown;
  /** Raw stderr, surfaced only when json is null so the UI can show why. */
  error?: string;
}

/**
 * Run one `nodectl --json <args...>` and return its parsed stdout.
 *
 * nodectl exits non-zero when nodes are unreachable (e.g. `mesh anchor`
 * returns 1 on any error row) but STILL prints a complete JSON document to
 * stdout describing that partial state. We therefore parse stdout regardless
 * of exit code and only fall back to the error branch when stdout has no JSON
 * at all — the down-node case is normal data, not a failure.
 */
function runNodectl(args: string[]): Promise<CmdResult> {
  return new Promise((resolve) => {
    execFile(
      NODECTL,
      ["--json", ...args],
      { timeout: CMD_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const raw = (stdout ?? "").trim();
        if (raw) {
          try {
            resolve({ json: JSON.parse(raw) });
            return;
          } catch {
            /* fall through — malformed JSON is a real failure */
          }
        }
        resolve({
          json: null,
          error:
            (stderr ?? "").trim() ||
            (err ? err.message : "no output from nodectl"),
        });
      },
    );
  });
}

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
  return `${result?.passed ?? devices.length - failed.length}/${result?.total ?? devices.length} ${verdict}${when}`;
}

/** Gather every source in parallel and merge into one snapshot for the pane. */
async function collectSnapshot(): Promise<Record<string, unknown>> {
  const [roster, anchor, peers, sensors, sceneNote, smokeNote] = await Promise.all([
    runNodectl(["fleet", "ls"]),
    runNodectl(["mesh", "anchor"]),
    runNodectl(["mesh", "peers"]),
    runNodectl(["sensors", "--on", "all"]),
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
    lastScene: formatScene(sceneNote),
    lastSmoke: formatSmoke(smokeNote),
  };
}

export async function GET(_req: NextRequest): Promise<Response> {
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
      }, 15_000);

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
