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
import * as net from "node:net";
import * as os from "node:os";
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

function isWaylandSession(): boolean {
  if ((process.env.XDG_SESSION_TYPE ?? "").toLowerCase() === "wayland") return true;
  return Boolean(process.env.WAYLAND_DISPLAY);
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
const DAEMON_SPAWN_TIMEOUT_MS = 5_000;

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

// ---------------------------------------------------------------------------
//  Daemon path — long-lived python helper, one per uid, shared across every
//  Node process on the box. Pattern lifted from browser-use/browser-harness:
//  unix socket for IPC, pid+started_at identity to defeat PID reuse, ping
//  liveness probe, connection-per-request, auto-spawn on first use,
//  auto-restart on crash. Falls back to one-shot spawn (legacy path) if the
//  daemon refuses to start so behaviour degrades gracefully on locked-down
//  hosts.
// ---------------------------------------------------------------------------

interface DaemonHandle {
  socket: string;
  pid: number;
  startedAt: number;
}

const DAEMON_DISABLED = process.env.CONTROL_DECK_NATIVE_NO_DAEMON === "1";

function uidSuffix(): string {
  return typeof process.getuid === "function" ? String(process.getuid()) : "anon";
}

function daemonSocketPath(): string {
  return path.join(os.tmpdir(), `control-deck-atspi-${uidSuffix()}.sock`);
}

function daemonPidPath(): string {
  return path.join(os.tmpdir(), `control-deck-atspi-${uidSuffix()}.pid`);
}

function isPidLive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPidFile(): DaemonHandle | null {
  try {
    const raw = JSON.parse(fs.readFileSync(daemonPidPath(), "utf8")) as {
      pid?: number;
      started_at?: number;
      socket?: string;
    };
    if (!raw.pid || !raw.socket) return null;
    return {
      pid: raw.pid,
      startedAt: typeof raw.started_at === "number" ? raw.started_at : 0,
      socket: raw.socket,
    };
  } catch {
    return null;
  }
}

let cachedDaemon: DaemonHandle | null = null;
let daemonStarting: Promise<DaemonHandle | null> | null = null;
let consecutiveDaemonFailures = 0;
const DAEMON_FAILURE_THRESHOLD = 3;
let daemonGivenUp = false;

async function pingSocket(sock: string, timeoutMs = 1_000): Promise<{ pid: number; startedAt: number } | null> {
  return new Promise((resolve) => {
    const client = net.createConnection(sock);
    let buf = "";
    const done = (val: { pid: number; startedAt: number } | null) => {
      try {
        client.destroy();
      } catch {
        /* ignore */
      }
      resolve(val);
    };
    const t = setTimeout(() => done(null), timeoutMs);
    client.on("error", () => {
      clearTimeout(t);
      done(null);
    });
    client.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      const line = buf.slice(0, nl);
      try {
        const parsed = JSON.parse(line) as {
          pong?: boolean;
          pid?: number;
          started_at?: number;
        };
        clearTimeout(t);
        if (parsed.pong && typeof parsed.pid === "number") {
          done({ pid: parsed.pid, startedAt: typeof parsed.started_at === "number" ? parsed.started_at : 0 });
        } else {
          done(null);
        }
      } catch {
        clearTimeout(t);
        done(null);
      }
    });
    client.on("connect", () => {
      client.write(JSON.stringify({ meta: "ping" }) + "\n");
    });
  });
}

async function adoptExistingDaemon(): Promise<DaemonHandle | null> {
  const recorded = readPidFile();
  if (!recorded || !isPidLive(recorded.pid)) return null;
  const pong = await pingSocket(recorded.socket);
  if (!pong) return null;
  // Identity check: refuse to talk to a stranger that took our socket.
  if (pong.pid !== recorded.pid) return null;
  if (recorded.startedAt && pong.startedAt && pong.startedAt !== recorded.startedAt) return null;
  return recorded;
}

async function spawnDaemon(): Promise<DaemonHandle | null> {
  return new Promise((resolve) => {
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn("python3", [HELPER, "--daemon"], {
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      resolve(null);
      return;
    }
    let stdoutBuf = "";
    let stderrBuf = "";
    let settled = false;
    const settle = (val: DaemonHandle | null) => {
      if (settled) return;
      settled = true;
      // Detach so the daemon outlives this Node process. Stream pipes are
      // closed (rather than unref'd) so the event loop doesn't keep them
      // alive — the daemon writes its ready line then talks over the socket.
      try {
        proc.unref();
        proc.stdout?.destroy();
        proc.stderr?.destroy();
      } catch {
        /* ignore */
      }
      resolve(val);
    };
    const timer = setTimeout(() => {
      settle(null);
    }, DAEMON_SPAWN_TIMEOUT_MS);
    proc.on("error", () => {
      clearTimeout(timer);
      settle(null);
    });
    proc.on("exit", (code) => {
      // Only warn on spawn-time failures (exit before signalling ready).
      // A later exit (signalled, intentional shutdown) is normal during
      // recovery and would otherwise be noisy.
      if (!settled) {
        clearTimeout(timer);
        if (code !== 0) {
          const tail = (stderrBuf || stdoutBuf).trim().split("\n").slice(-3).join(" | ");
          if (tail) {
            // eslint-disable-next-line no-console
            console.warn(`atspi daemon failed to start (code ${code}): ${tail}`);
          }
        }
        settle(null);
      }
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString("utf8");
    });
    proc.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString("utf8");
      const nl = stdoutBuf.indexOf("\n");
      if (nl < 0) return;
      const line = stdoutBuf.slice(0, nl);
      try {
        const parsed = JSON.parse(line) as {
          ready?: boolean;
          socket?: string;
          pid?: number;
        };
        if (parsed.ready && parsed.socket && typeof parsed.pid === "number") {
          clearTimeout(timer);
          settle({
            socket: parsed.socket,
            pid: parsed.pid,
            startedAt: 0, // refined by next pingSocket call
          });
        }
      } catch {
        // not the ready line; keep buffering
      }
    });
  });
}

async function ensureDaemon(): Promise<DaemonHandle | null> {
  if (DAEMON_DISABLED || daemonGivenUp) return null;
  if (cachedDaemon) return cachedDaemon;
  if (daemonStarting) return daemonStarting;
  daemonStarting = (async () => {
    try {
      const adopted = await adoptExistingDaemon();
      if (adopted) {
        cachedDaemon = adopted;
        consecutiveDaemonFailures = 0;
        return adopted;
      }
      const spawned = await spawnDaemon();
      if (!spawned) {
        consecutiveDaemonFailures += 1;
        if (consecutiveDaemonFailures >= DAEMON_FAILURE_THRESHOLD) {
          daemonGivenUp = true;
        }
        return null;
      }
      // Confirm by ping — also refines startedAt.
      const pong = await pingSocket(spawned.socket);
      if (!pong) {
        consecutiveDaemonFailures += 1;
        return null;
      }
      cachedDaemon = { ...spawned, startedAt: pong.startedAt };
      consecutiveDaemonFailures = 0;
      return cachedDaemon;
    } finally {
      daemonStarting = null;
    }
  })();
  return daemonStarting;
}

async function callDaemon<T>(handle: DaemonHandle, cmd: HelperCommand): Promise<HelperResult<T>> {
  return new Promise((resolve) => {
    const client = net.createConnection(handle.socket);
    let buf = "";
    let settled = false;
    const settle = (val: HelperResult<T>) => {
      if (settled) return;
      settled = true;
      try {
        client.destroy();
      } catch {
        /* ignore */
      }
      resolve(val);
    };
    const timer = setTimeout(() => {
      settle({ ok: false, error: "atspi daemon call timed out" });
    }, HELPER_TIMEOUT_MS);
    client.on("error", (err) => {
      clearTimeout(timer);
      settle({ ok: false, error: `daemon socket error: ${err.message}` });
    });
    client.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      const line = buf.slice(0, nl);
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(line) as HelperResult<T>;
        settle(parsed);
      } catch (err) {
        settle({
          ok: false,
          error: `invalid daemon output: ${err instanceof Error ? err.message : err}`,
        });
      }
    });
    client.on("connect", () => {
      client.write(JSON.stringify(cmd) + "\n");
    });
  });
}

async function runOneShot<T>(cmd: HelperCommand): Promise<HelperResult<T>> {
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

async function runHelper<T>(cmd: HelperCommand): Promise<HelperResult<T>> {
  const handle = await ensureDaemon();
  if (handle) {
    const res = await callDaemon<T>(handle, cmd);
    if (res.ok) return res;
    // Socket-layer failure (not a domain error) — if the message looks like
    // the daemon went away, drop the cache so the next call respawns.
    if (res.error && /socket error|timed out/i.test(res.error)) {
      cachedDaemon = null;
      const retry = await ensureDaemon();
      if (retry) {
        return await callDaemon<T>(retry, cmd);
      }
    }
    return res;
  }
  return runOneShot<T>(cmd);
}

/** Test-only: drop the daemon handle so the next call re-discovers/respawns. */
export function __resetDaemonCache(): void {
  cachedDaemon = null;
  daemonStarting = null;
  consecutiveDaemonFailures = 0;
  daemonGivenUp = false;
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
    const res = await runHelper<{
      method?: ClickResult["method"] | "mouse-required";
      bounds?: { x: number; y: number; width: number; height: number };
      x?: number;
      y?: number;
      reason?: string;
    }>({ op: "click", handle });
    if (!res.ok) throw new Error(res.error ?? "click failed");

    const method = res.data?.method ?? "unknown";
    if (method === "mouse-required") {
      // Helper signalled it can't synthesize a mouse event itself (Wayland
      // session, or XTest broken on X11). Route through the portal's
      // RemoteDesktop click_pixel using the element's bounds-center.
      loadPortalHandoff();
      if (!PORTAL_URL) {
        const why = res.data?.reason ?? "wayland";
        throw new Error(
          `native_click needs portal click_pixel fallback (${why}) but CONTROL_DECK_PORTAL_URL is not set — run inside Electron`,
        );
      }
      const b = res.data?.bounds;
      const cx = res.data?.x ?? (b ? Math.round(b.x + b.width / 2) : NaN);
      const cy = res.data?.y ?? (b ? Math.round(b.y + b.height / 2) : NaN);
      if (!Number.isFinite(cx) || !Number.isFinite(cy)) {
        throw new Error("native_click mouse-required but no usable bounds returned");
      }
      await callPortal({ op: "click_pixel", x: cx, y: cy, button: "left" });
      return { method: "mouse" };
    }

    if (method === "action" || method === "focus+enter" || method === "mouse") {
      return { method };
    }
    return { method: "unknown" };
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
    // Prefer the portal whenever it's reachable. AT-SPI's
    // generateKeyboardEvent is XTest-only — on Wayland-native targets
    // (Chrome --ozone-platform=wayland, GTK4 apps, Electron) it returns
    // success but silently no-ops, leaving callers unable to tell the
    // keystroke never arrived.
    loadPortalHandoff();
    if (PORTAL_URL) {
      const { modifiers, primary } = parseKeySpec(event.key);
      await callPortal({ op: "key", modifiers, keysym: primary });
      return;
    }
    if (isWaylandSession()) {
      throw new Error(
        `native_key needs portal fallback on Wayland (XTest only reaches X11 windows). ` +
        `Set CONTROL_DECK_PORTAL_URL or run inside Electron.`,
      );
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
