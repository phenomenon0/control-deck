import { execFile } from "child_process";
import { access } from "fs/promises";
import { constants as FS } from "fs";
import path from "path";

/**
 * The bridge from control-deck to the ipad-lab control plane.
 *
 * Lives beside the routes rather than inside either of them because both the
 * read path (route.ts) and the write path (action/route.ts) need it, and a
 * Next route module may only export handlers — it cannot be imported from.
 * Keeping one copy matters here: these are the settings that decide whether a
 * command reaches the hardware at all.
 */

/** Absolute path to the ipad-lab control-plane CLI; overridable for other checkouts. */
export const NODECTL =
  process.env.FLEET_NODECTL ??
  "/home/omen/Documents/Project/ipad-lab/bin/nodectl";

/** <repo>/bin/nodectl -> <repo>. See runNodectl's cwd note for why this matters. */
export const REPO_ROOT = path.resolve(path.dirname(NODECTL), "..");

/**
 * Each nodectl call opens TCP to up to five hosts with its own per-host
 * timeout; 25s is a generous ceiling that only trips if the CLI itself wedges.
 */
const CMD_TIMEOUT_MS = 25_000;

export interface CmdResult {
  /** Parsed JSON stdout, or null when the CLI produced no valid JSON. */
  json: unknown;
  /** Raw stderr, surfaced only when json is null so the UI can show why. */
  error?: string;
}

/**
 * Is the CLI actually there? Callers check this ONCE, before their first call.
 *
 * The default above is one developer's absolute path. On any other checkout
 * every execFile fails identically, and without this the pane renders several
 * separate "no output from nodectl" errors that look exactly like a fleet-wide
 * outage — the operator goes looking at the hardware for a problem that is in
 * the environment. A configuration error must announce itself as one.
 */
export async function nodectlProblem(): Promise<string | null> {
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
 * Run one `nodectl --json <args...>` and return its parsed stdout.
 *
 * nodectl exits non-zero when nodes are unreachable (e.g. `mesh anchor`
 * returns 1 on any error row, `wall show` returns 1 when one pad is skipped)
 * but STILL prints a complete JSON document to stdout describing that partial
 * state. We therefore parse stdout regardless of exit code and only fall back
 * to the error branch when stdout has no JSON at all — the down-node case is
 * normal data, not a failure, and on the write path it is the difference
 * between "three pads took it, ipad-e was asleep" and a blank error.
 *
 * execFile, never a shell: the argv here is assembled from an allowlist, and
 * the absence of a shell is what keeps it from ever being more than that.
 *
 * cwd is the ipad-lab repo root, and it is load-bearing rather than tidiness:
 * scene paths inside a macro are resolved relative to the CALLER's working
 * directory, so `macro run blank` run from Next's cwd finds no scene file and
 * fails while looking like an ordinary partial result.
 */
export function runNodectl(args: string[]): Promise<CmdResult> {
  return new Promise((resolve) => {
    execFile(
      NODECTL,
      ["--json", ...args],
      {
        cwd: REPO_ROOT,
        timeout: CMD_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
      },
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
