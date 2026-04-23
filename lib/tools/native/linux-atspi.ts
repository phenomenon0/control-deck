/**
 * Linux AT-SPI adapter — drives GTK/Qt apps via the accessibility bus.
 *
 * Uses a small python `pyatspi` helper shelled out per call. We do the
 * heavy lifting in python because pyatspi's bindings are stable and
 * there is no maintained node equivalent as of early 2026.
 *
 * The helper is expected at `scripts/atspi-helper.py` and takes a JSON
 * command on stdin, prints a JSON result on stdout.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseKeySpec } from "./keysym";
import type {
  ClickPixelArgs,
  ClickResult,
  FocusWindowResult,
  KeyEvent,
  LocateQuery,
  NativeAdapter,
  NodeHandle,
  ScreenGrabResult,
  TreeNode,
} from "./types";

const ENV_PORTAL_URL = process.env.CONTROL_DECK_PORTAL_URL || "";
const ENV_PORTAL_SECRET = process.env.CONTROL_DECK_PORTAL_SECRET || "";
let PORTAL_URL = ENV_PORTAL_URL;
let PORTAL_SECRET = ENV_PORTAL_SECRET;
let lastHandoffPid: number | null = null;

// Dev-mode fallback: Electron writes its ephemeral port + secret to a
// per-user handoff file when the packaged env-propagation path isn't in use.
// Must reload when Electron restarts (new PID → new port).
//
// Liveness check: we only trust the handoff if its `pid` is a live process
// we own. A stale handoff from a crashed run — or a hostile file dropped
// by another process running as the same user — is ignored so we don't
// POST the portal secret to whatever address it advertises.
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    // ESRCH = no such process. EPERM = process exists but isn't ours —
    // we refuse to trust that handoff either, so treat both as not-alive.
    return false;
  }
}

function loadPortalHandoff(): void {
  if (ENV_PORTAL_URL) return; // prod: env is authoritative
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (uid === null) return;
  const p = `/tmp/control-deck-portal-${uid}.json`;
  try {
    if (!fs.existsSync(p)) return;
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as {
      url?: string;
      secret?: string;
      pid?: number;
    };
    const pid = typeof raw.pid === "number" ? raw.pid : null;
    if (pid === null || !isPidAlive(pid)) {
      // Stale or unowned handoff — refuse to adopt its url/secret.
      return;
    }
    if (pid === lastHandoffPid && PORTAL_URL) return;
    if (raw.url) PORTAL_URL = raw.url;
    if (raw.secret) PORTAL_SECRET = raw.secret;
    lastHandoffPid = pid;
  } catch {
    // handoff file missing or unreadable — leave values as-is
  }
}

async function callPortal<T extends { ok?: boolean; error?: string } = { ok?: boolean; error?: string }>(
  body: Record<string, unknown>,
): Promise<T> {
  loadPortalHandoff();
  if (!PORTAL_URL) {
    throw new Error("portal URL not configured (Electron not running?)");
  }
  const res = await fetch(PORTAL_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-deck-portal-auth": PORTAL_SECRET,
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T;
  if (!res.ok || !json.ok) {
    throw new Error(json.error || `portal ${res.status}`);
  }
  return json;
}

function resolveHelper(): string {
  const candidates = [
    process.env.CONTROL_DECK_SCRIPTS_DIR
      ? path.join(process.env.CONTROL_DECK_SCRIPTS_DIR, "atspi-helper.py")
      : null,
    path.join(process.cwd(), "scripts", "atspi-helper.py"),
    path.join(process.cwd(), "..", "scripts", "atspi-helper.py"),
    path.join(process.cwd(), "..", "..", "scripts", "atspi-helper.py"),
  ].filter((p): p is string => p !== null);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0] ?? path.join(process.cwd(), "scripts", "atspi-helper.py");
}

const HELPER = resolveHelper();
const HELPER_TIMEOUT_MS = 5_000;

interface HelperCommand {
  op: "locate" | "click" | "type" | "tree" | "available" | "key" | "focus";
  query?: LocateQuery;
  handle?: NodeHandle;
  text?: string;
  key?: string;
}

interface HelperResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

async function runHelper<T>(cmd: HelperCommand): Promise<HelperResult<T>> {
  return new Promise((resolve) => {
    const proc = spawn("python3", [HELPER], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      resolve({ ok: false, error: "atspi helper timed out" });
    }, HELPER_TIMEOUT_MS);

    proc.stdout.on("data", (chunk) => (stdout += chunk.toString("utf8")));
    proc.stderr.on("data", (chunk) => (stderr += chunk.toString("utf8")));
    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: err.message });
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolve({
          ok: false,
          error: stderr.trim() || `helper exited with code ${code}`,
        });
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as HelperResult<T>;
        resolve(parsed);
      } catch (err) {
        resolve({
          ok: false,
          error: `invalid helper output: ${err instanceof Error ? err.message : err}`,
        });
      }
    });

    proc.stdin.write(JSON.stringify(cmd));
    proc.stdin.end();
  });
}

export const linuxAtspiAdapter: NativeAdapter = {
  platform: "linux",

  async isAvailable() {
    const res = await runHelper<{ ok: boolean }>({ op: "available" });
    return res.ok === true;
  },

  async locate(query) {
    const res = await runHelper<NodeHandle[]>({ op: "locate", query });
    if (!res.ok) throw new Error(res.error ?? "locate failed");
    return res.data ?? [];
  },

  async click(handle): Promise<ClickResult> {
    const res = await runHelper<{ method?: ClickResult["method"] }>({ op: "click", handle });
    if (!res.ok) throw new Error(res.error ?? "click failed");
    return { method: res.data?.method ?? "unknown" };
  },

  async typeText(handle, text) {
    if (handle) {
      const res = await runHelper({ op: "type", handle, text });
      if (res.ok) return;
      if (!PORTAL_URL) throw new Error(res.error ?? "type failed");
    }
    if (PORTAL_URL) {
      await callPortal({ op: "type", text });
      return;
    }
    const res = await runHelper({ op: "type", text });
    if (!res.ok) throw new Error(res.error ?? "type failed");
  },

  async getTree(handle) {
    const res = await runHelper<TreeNode>({ op: "tree", handle });
    if (!res.ok) throw new Error(res.error ?? "tree failed");
    if (!res.data) throw new Error("empty tree response");
    return res.data;
  },

  async key(event: KeyEvent) {
    if (PORTAL_URL) {
      const { modifiers, primary } = parseKeySpec(event.key);
      await callPortal({ op: "key", modifiers, keysym: primary });
      return;
    }
    const res = await runHelper({ op: "key", key: event.key });
    if (!res.ok) throw new Error(res.error ?? "key failed");
  },

  async focus(handle) {
    const res = await runHelper<{ focused?: boolean }>({ op: "focus", handle });
    if (!res.ok) throw new Error(res.error ?? "focus failed");
    return Boolean(res.data?.focused);
  },

  async screenGrab(): Promise<ScreenGrabResult> {
    loadPortalHandoff();
    if (!PORTAL_URL) {
      throw new Error(
        "screen_grab needs the Electron portal bridge; set CONTROL_DECK_PORTAL_URL (auto-set when running inside Electron)",
      );
    }
    const r = await callPortal<{
      ok?: boolean;
      error?: string;
      png_base64?: string;
      width?: number;
      height?: number;
    }>({ op: "screen_grab" });
    if (!r.png_base64 || !r.width || !r.height) {
      throw new Error("screen_grab response missing png/width/height");
    }
    return { pngBase64: r.png_base64, width: r.width, height: r.height };
  },

  async focusWindow(appId): Promise<FocusWindowResult> {
    loadPortalHandoff();
    if (!PORTAL_URL) {
      throw new Error(
        "focus_window needs the Electron portal bridge; set CONTROL_DECK_PORTAL_URL (auto-set when running inside Electron)",
      );
    }
    const r = await callPortal<{
      ok?: boolean;
      error?: string;
      dispatched?: boolean;
      log?: string;
    }>({ op: "focus_window", app_id: appId });
    return {
      dispatched: Boolean(r.dispatched),
      log: r.log ?? "",
    };
  },

  async clickPixel(args: ClickPixelArgs): Promise<void> {
    loadPortalHandoff();
    if (!PORTAL_URL) {
      throw new Error(
        "click_pixel needs the Electron portal bridge; set CONTROL_DECK_PORTAL_URL (auto-set when running inside Electron)",
      );
    }
    await callPortal({
      op: "click_pixel",
      x: args.x,
      y: args.y,
      button: args.button ?? "left",
    });
  },
};
