/**
 * agent-ts launcher — spawns the local pi-agent-core runtime (apps/agent-ts)
 * from a Next.js route.
 *
 * `start-full-stack.sh` does the equivalent at the shell level; this module
 * replicates it in-process with `spawn(detached: true).unref()` so the child
 * lives after the request returns. Then we poll `/health` until it answers
 * or we hit the timeout.
 *
 * Server-side only. Spawns a real OS process.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO_ROOT = process.cwd();

const AGENT_TS_DEFAULT_URL = "http://localhost:4244";
const AGENT_TS_DEFAULT_PORT = 4244;

/**
 * Wire URL for the agent runtime. Kept named `AGENTGO_URL` for back-compat
 * with callers across the deck — the contract is "the AG-UI/SSE endpoint
 * the chat route talks to", which is agent-ts now.
 */
export const AGENTGO_URL =
  process.env.AGENT_TS_URL ?? process.env.AGENTGO_URL ?? AGENT_TS_DEFAULT_URL;

/**
 * The shared token Next uses to call agent-ts side-effect routes. agent-ts
 * accepts either AGENT_TS_TOKEN or DECK_TOKEN as the auth source, so we look
 * up the same precedence here. Returns "" when no token is configured —
 * agent-ts falls through in dev when the token is absent.
 */
export function getAgentTsToken(): string {
  return process.env.AGENT_TS_TOKEN ?? process.env.DECK_TOKEN ?? "";
}

/**
 * Inject the agent-ts auth header into outbound requests when a token is
 * configured. Safe to call when no token is set (returns the original headers
 * untouched). Use for /runs, /runs/:id/approve, /reject, /pause, /resume,
 * /cancel — anything except /health.
 */
export function withAgentTsAuth(headers: HeadersInit = {}): Headers {
  const out = new Headers(headers);
  const token = getAgentTsToken();
  if (token && !out.has("Authorization") && !out.has("X-Agent-TS-Token")) {
    out.set("Authorization", `Bearer ${token}`);
  }
  return out;
}

/**
 * Resolve where the agent-ts entry lives. Order:
 *   1. AGENT_TS_ENTRY env (explicit override) — must end in .js or .ts.
 *   2. Compiled bundle at apps/agent-ts/dist/server/main.js.
 *   3. Source entry at apps/agent-ts/src/server/main.ts (run via tsx).
 */
function resolveAgentTsEntry(): { entry: string; mode: "node" | "tsx" } | null {
  const explicit = process.env.AGENT_TS_ENTRY;
  if (explicit) {
    const mode = explicit.endsWith(".ts") || explicit.endsWith(".tsx") ? "tsx" : "node";
    return { entry: explicit, mode };
  }
  const dist = path.join(REPO_ROOT, "apps", "agent-ts", "dist", "server", "main.js");
  if (fs.existsSync(dist)) return { entry: dist, mode: "node" };
  const src = path.join(REPO_ROOT, "apps", "agent-ts", "src", "server", "main.ts");
  if (fs.existsSync(src)) return { entry: src, mode: "tsx" };
  return null;
}

const LOG_DIR =
  process.env.AGENTGO_LOG_DIR ??
  path.join(
    process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state"),
    "control-deck",
  );

export interface HealthResult {
  online: boolean;
  url: string;
  latencyMs?: number;
  version?: string;
  error?: string;
}

export async function probeHealth(timeoutMs = 1200): Promise<HealthResult> {
  const url = AGENTGO_URL;
  const start = Date.now();
  try {
    const res = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!res.ok) return { online: false, url, error: `${res.status}` };
    const data = (await res.json().catch(() => null)) as { version?: string } | null;
    return { online: true, url, latencyMs: Date.now() - start, version: data?.version };
  } catch (e) {
    return { online: false, url, error: e instanceof Error ? e.message : "unreachable" };
  }
}

export interface LaunchResult {
  status: "already-running" | "launched" | "failed";
  pid?: number;
  url: string;
  error?: string;
  logPath?: string;
}

/**
 * Spawn agent-ts (apps/agent-ts) and poll /health until it's up or the
 * 10s deadline elapses. Idempotent — returns early if it's already running.
 */
export async function launchAgent(): Promise<LaunchResult> {
  const pre = await probeHealth();
  if (pre.online) {
    return { status: "already-running", url: AGENTGO_URL };
  }

  fs.mkdirSync(LOG_DIR, { recursive: true });

  const entry = resolveAgentTsEntry();
  if (!entry) {
    return {
      status: "failed",
      url: AGENTGO_URL,
      error:
        "agent-ts entry not found. Set AGENT_TS_ENTRY, build apps/agent-ts (dist/), or check that apps/agent-ts/src/server/main.ts exists.",
    };
  }

  const logPath = path.join(LOG_DIR, "agent-ts.log");
  const logFd = fs.openSync(logPath, "a");

  // Resolve interpreter. tsx is shipped with apps/agent-ts/node_modules.
  let cmd: string;
  let argv: string[];
  if (entry.mode === "tsx") {
    const localTsx = path.join(REPO_ROOT, "apps", "agent-ts", "node_modules", ".bin", "tsx");
    cmd = fs.existsSync(localTsx) ? localTsx : "npx";
    argv = cmd === "npx" ? ["tsx", entry.entry] : [entry.entry];
  } else {
    cmd = process.execPath; // node
    argv = [entry.entry];
  }

  const port = process.env.AGENT_TS_PORT ?? process.env.AGENTGO_PORT ?? String(AGENT_TS_DEFAULT_PORT);
  // Co-spawn with a known auth token so this process and the spawned child
  // agree without an extra handshake. Default to DECK_TOKEN; agent-ts side
  // accepts AGENT_TS_TOKEN OR DECK_TOKEN as the auth source.
  const agentToken =
    process.env.AGENT_TS_TOKEN ?? process.env.DECK_TOKEN ?? "";
  try {
    const child = spawn(cmd, argv, {
      cwd: REPO_ROOT,
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: {
        ...process.env,
        AGENTGO_PORT: port,
        AGENT_TS_PORT: port,
        ...(agentToken ? { AGENT_TS_TOKEN: agentToken, DECK_TOKEN: agentToken } : {}),
      },
    });
    child.unref();

    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 400));
      const hp = await probeHealth(600);
      if (hp.online) {
        return { status: "launched", pid: child.pid, url: AGENTGO_URL, logPath };
      }
    }
    return {
      status: "failed",
      url: AGENTGO_URL,
      error: "agent-ts spawned but /health never answered within 10s",
      logPath,
      pid: child.pid,
    };
  } catch (e) {
    return {
      status: "failed",
      url: AGENTGO_URL,
      error: e instanceof Error ? e.message : "spawn failed",
      logPath,
    };
  }
}
