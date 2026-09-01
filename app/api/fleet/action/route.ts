import { NextRequest } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

import { jsonError } from "@/lib/http/json";
import { denyIfCrossOrigin } from "@/lib/security/originGuard";
import { REPO_ROOT, nodectlProblem, runNodectl } from "../nodectl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/fleet/action
 *
 * The fleet's only write path from a browser or the GNOME panel widget.
 *
 * Body: { action: string, params?: Record<string, unknown> }
 * Reply: { ok, action, argv, result } — or 400 { error } naming what was wrong.
 *
 * THE CALLER NEVER SUPPLIES CLI ARGUMENTS. It names an action and passes typed
 * parameters; the table below is the only thing that turns those into an argv.
 * That inversion is the entire security boundary of this route: `nodectl` is a
 * CLI that can reboot hardware, install packages and open shells on four
 * jailbroken devices, and the set of things this route can ask it to do is
 * fixed at six entries by construction rather than by validation.
 *
 * Consequently: DO NOT ADD A PASSTHROUGH. No "args" key, no "extra flags", no
 * action whose parameter is itself a nodectl subcommand. Every parameter below
 * is narrowed to an enum, a roster member, or a clamped number before it can
 * reach an argv position, and anything unrecognised is a 400 rather than a
 * best-effort guess. runNodectl uses execFile with no shell, so an argv entry
 * is only ever one argument — but that is the second line of defence, not the
 * first.
 *
 * The six actions are the ones with a physical meaning at the glass:
 * three shaders, `identify` (what you press while arranging pads by hand),
 * `wall.tap` (touch, which is what makes the ripple land somewhere),
 * `wall.swap` (reconcile the file with the pads on the table),
 * `display.brightness` (the only lever the dashboard has over battery life),
 * and the two macros that matter — `wake` to recover a wedged renderer and
 * `blank` to turn the wall off.
 *
 * `display.brightness` is the one action that reaches nodehald rather than
 * noderender, so its parameter is JSON on an argv position instead of a bare
 * string. It is built with JSON.stringify from an already-clamped number,
 * never by interpolating the caller's value into a string.
 */

/** Shaders noderender actually has. There is no runtime upload path. */
const FX = ["ripple", "plasma", "sweep"] as const;

/**
 * Macros safe to fire from a click. Deliberately NOT the full macro list:
 * `smoke` repaints every pad it touches, and `demo`/`status` are diagnostics
 * with their own side effects on the glass.
 */
const MACROS = ["wake", "blank"] as const;

function pickFx(v: unknown): string {
  if (typeof v === "string" && (FX as readonly string[]).includes(v)) return v;
  throw new Error(`fx must be one of ${FX.join(", ")}`);
}

function pickMacro(v: unknown): string {
  if (typeof v === "string" && (MACROS as readonly string[]).includes(v)) return v;
  throw new Error(`macro must be one of ${MACROS.join(", ")}`);
}

/** A wall coordinate: a fraction of the whole wall, not of one pad. */
function frac(v: unknown): string {
  const n = typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw new Error("gx and gy must be numbers in 0..1 (fractions of the wall)");
  }
  return n.toFixed(4);
}

/**
 * The node roster, read from the same seed file nodectl itself uses.
 *
 * Only the ids are taken. fleet.json also carries the fleet's shared HAL
 * token, which must never leave the host — reading the file here is fine,
 * returning anything but ids from it is not.
 *
 * Re-read per request rather than cached: adding a pad to the roster should
 * not need a Next restart, and this is a small local file next to a call that
 * is about to talk to hardware over a radio.
 */
async function roster(): Promise<string[]> {
  const raw = await readFile(
    path.join(REPO_ROOT, "host", "nodectl", "fleet.json"),
    "utf8",
  );
  const devices = (JSON.parse(raw) as { devices?: Array<{ id?: unknown }> }).devices;
  if (!Array.isArray(devices)) throw new Error("fleet.json has no devices array");
  return devices
    .map((d) => d.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

/** "all", or ids that are actually in the roster. Never an arbitrary string. */
async function pickNodes(v: unknown): Promise<string> {
  if (v === undefined || v === null || v === "all") return "all";
  const want = Array.isArray(v) ? v : String(v).split(",");
  const known = await roster();
  const ids = want.map((x) => String(x).trim()).filter(Boolean);
  if (ids.length === 0) throw new Error("on: no node ids given");
  const unknownIds = ids.filter((id) => !known.includes(id));
  if (unknownIds.length) {
    throw new Error(
      `unknown node(s): ${unknownIds.join(", ")} — roster is ${known.join(", ")}`,
    );
  }
  return ids.join(",");
}

/** Exactly one roster member. `all` is meaningless for a swap. */
async function pickNode(v: unknown, which: string): Promise<string> {
  const id = typeof v === "string" ? v.trim() : "";
  if (!id) throw new Error(`${which}: need a node id`);
  const known = await roster();
  if (!known.includes(id)) {
    throw new Error(`unknown node '${id}' — roster is ${known.join(", ")}`);
  }
  return id;
}

/**
 * A 0..1 brightness. Clamping is NOT done here on purpose: nodehald already
 * clamps, and silently accepting 5 would make the slider and the glass
 * disagree with no way to tell which is right. Out of range is a 400.
 */
function pickLevel(v: unknown): number {
  const n = typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw new Error("level must be a number in 0..1");
  }
  return n;
}

type Params = Record<string, unknown>;

const ACTIONS: Record<string, (p: Params) => Promise<string[]>> = {
  "wall.show": async (p) => ["wall", "show", pickFx(p.fx), "--on", await pickNodes(p.on)],
  "wall.identify": async (p) => ["wall", "identify", "--on", await pickNodes(p.on)],
  // No --on: a tap is a point on the WALL, and every pad has to be told where
  // it landed so the ones it misses can stop drawing from the old origin.
  "wall.tap": async (p) => ["wall", "tap", frac(p.gx), frac(p.gy)],
  "macro.run": async (p) => ["macro", "run", pickMacro(p.name), "--on", await pickNodes(p.on)],
  // Writes wall.json. Swap rather than assign, so the grid stays a permutation
  // and can never end up with a hole or two pads booked into one cell.
  "wall.swap": async (p) => [
    "wall",
    "swap",
    await pickNode(p.a, "a"),
    await pickNode(p.b, "b"),
  ],
  "display.brightness": async (p) => [
    "fleet",
    "call",
    "display.setBrightness",
    JSON.stringify({ value: pickLevel(p.level) }),
    "--on",
    await pickNodes(p.on),
  ],
};

export async function POST(req: NextRequest): Promise<Response> {
  // Belt-and-braces with middleware's origin gate: keeps this route safe on
  // its own (it talks to hardware) and lets route.test.ts pin it directly.
  const denied = denyIfCrossOrigin(req);
  if (denied) return denied;

  let body: { action?: unknown; params?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonError("body must be JSON: { action, params? }");
  }

  const action = typeof body.action === "string" ? body.action : "";
  const build = Object.prototype.hasOwnProperty.call(ACTIONS, action)
    ? ACTIONS[action]
    : undefined;
  if (!build) {
    return jsonError(`unknown action '${action}' — have ${Object.keys(ACTIONS).join(", ")}`);
  }

  const params =
    body.params && typeof body.params === "object" && !Array.isArray(body.params)
      ? (body.params as Params)
      : {};

  let argv: string[];
  try {
    argv = await build(params);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err));
  }

  const problem = await nodectlProblem();
  if (problem) {
    return jsonError(problem, 503);
  }

  const res = await runNodectl(argv);
  // A partial result is a 200 with a body that says which pads were skipped —
  // nodectl exits 1 for one dark panel out of four, and reporting that as a
  // failed request would hide the three that took it.
  return new Response(
    JSON.stringify({
      ok: res.json !== null,
      action,
      argv,
      result: res.json,
      error: res.error,
    }),
    { headers: { "content-type": "application/json" } },
  );
}
