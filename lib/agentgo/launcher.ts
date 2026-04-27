/**
 * Agent-GO launcher — spawns the Go binary from a Next.js route.
 *
 * The existing `start-full-stack.sh` script does:
 *   cd $AGENTGO_DIR && nohup ./agentgo-server > log 2>&1 &
 *
 * We replicate that in-process with `spawn(detached: true).unref()` so the
 * child lives after the Next.js request returns. Then we poll `/health`
 * until it comes up or we hit a timeout.
 *
 * Server-side only. Spawns a real OS process.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO_ROOT = process.cwd();

// Default runtime is the TS agent (apps/agent-ts) on :4244. Set
// `AGENT_RUNTIME=go` (or `USE_AGENT_GO=1`) to pin the legacy Go binary —
// kept around for one release as a fallback. `USE_AGENT_TS=1` is still
// honoured for explicitness.
const USE_AGENT_GO =
  process.env.USE_AGENT_GO === "1" || process.env.AGENT_RUNTIME === "go";
const USE_AGENT_TS = !USE_AGENT_GO;

const AGENT_TS_DEFAULT_URL = "http://localhost:4244";
const AGENT_TS_DEFAULT_PORT = 4244;
const AGENT_GO_DEFAULT_URL = "http://localhost:4243";

export const AGENTGO_URL = USE_AGENT_TS
  ? (process.env.AGENT_TS_URL ?? process.env.AGENTGO_URL ?? AGENT_TS_DEFAULT_URL)
  : (process.env.AGENTGO_URL ?? AGENT_GO_DEFAULT_URL);

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

export const AGENTGO_DIR =
  process.env.AGENTGO_DIR ?? path.join(os.homedir(), "Documents", "Project", "Agent-GO");
const AGENTGO_BINARY = "agentgo-server";

/**
 * Resolve where the TS agent runtime lives. Order:
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

export async function launchAgentGo(): Promise<LaunchResult> {
  // Idempotent: if it's already up, just say so.
  const pre = await probeHealth();
  if (pre.online) {
    return { status: "already-running", url: AGENTGO_URL };
  }

  fs.mkdirSync(LOG_DIR, { recursive: true });
  if (USE_AGENT_TS) return launchAgentTs();

  // Verify binary exists.
  const binary = path.join(AGENTGO_DIR, AGENTGO_BINARY);
  if (!fs.existsSync(binary)) {
    return {
      status: "failed",
      url: AGENTGO_URL,
      error: `binary not found at ${binary}. Set AGENTGO_DIR or build agentgo-server.`,
    };
  }

  // Prepare log file (append mode so multiple launches don't clobber).
  const logPath = path.join(LOG_DIR, "agentgo.log");
  const logFd = fs.openSync(logPath, "a");

  try {
    const child = spawn(binary, [], {
      cwd: AGENTGO_DIR,
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: {
        ...process.env,
        AGENTGO_LLM_PROVIDER: process.env.AGENTGO_LLM_PROVIDER ?? "ollama",
        OLLAMA_MODEL: process.env.OLLAMA_MODEL ?? "qwen2",
      },
    });
    child.unref();

    // Poll /health until it responds or we give up.
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
      error: "spawned but /health never answered within 10s",
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

/**
 * Spawn the TS replacement (apps/agent-ts). Same wire contract on its own
 * port (default :4244). Reaches the same `probeHealth`/`/health` endpoint
 * once it's up.
 */
async function launchAgentTs(): Promise<LaunchResult> {
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
