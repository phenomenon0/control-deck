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

export const AGENTGO_URL = process.env.AGENTGO_URL ?? "http://localhost:4243";
export const AGENTGO_DIR =
  process.env.AGENTGO_DIR ?? path.join(os.homedir(), "Documents", "Project", "Agent-GO");
const AGENTGO_BINARY = "agentgo-server";
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
  fs.mkdirSync(LOG_DIR, { recursive: true });
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
