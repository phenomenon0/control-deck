/**
 * Auto-spawn `apps/agent-ts` (the pi-agent-core chat backend) from Electron
 * main. Mirrors `voice-core-supervisor.ts`: skip if the port is already
 * listening, restart on crash up to 3 times in 5 minutes, kill on quit.
 *
 * Spawn order:
 *   1. `bunx tsx apps/agent-ts/src/server/main.ts` (preferred)
 *   2. `npx tsx apps/agent-ts/src/server/main.ts`  fallback
 *
 * Inference target is whatever agent-ts resolves at request time — the
 * supervisor only sets AGENT_TS_PORT; LLM_BASE_URL/LLM_MODEL fall through
 * to process.env (so .env.local + Electron-injected vars keep working).
 */

import { app } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";

const RESTART_MAX = 3;
const RESTART_WINDOW_MS = 5 * 60 * 1000;
const RESTART_DELAY_MS = 2_000;

interface AgentTsProc {
  kill(): void;
}

let proc: ChildProcess | null = null;
let restarts: number[] = [];
let isShuttingDown = false;

export function startAgentTsSupervisor(): AgentTsProc {
  const host = process.env.AGENT_TS_HOST ?? "127.0.0.1";
  const port = Number(process.env.AGENT_TS_PORT ?? "4244");

  isPortListening(port, host).then((listening) => {
    if (listening) {
      console.log(
        `[agent-ts] port ${port} already listening — assuming prior instance, not spawning`,
      );
      return;
    }
    launch(host, port);
  });

  return {
    kill() {
      isShuttingDown = true;
      if (proc && !proc.killed) {
        try {
          proc.kill("SIGTERM");
        } catch {
          /* ignore */
        }
      }
      proc = null;
    },
  };
}

function isPortListening(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(400);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

interface SpawnPlan {
  command: string;
  args: string[];
  cwd: string;
  description: string;
}

function planSpawn(): SpawnPlan | null {
  const root = repoRoot();
  const entry = path.join(root, "apps", "agent-ts", "src", "server", "main.ts");
  if (!fs.existsSync(entry)) return null;

  const relEntry = "apps/agent-ts/src/server/main.ts";

  const bun = which("bunx");
  if (bun) {
    return {
      command: bun,
      args: ["tsx", relEntry],
      cwd: root,
      description: "bunx tsx",
    };
  }

  const npx = which("npx");
  if (npx) {
    return {
      command: npx,
      args: ["tsx", relEntry],
      cwd: root,
      description: "npx tsx",
    };
  }

  return null;
}

function launch(host: string, port: number): void {
  const plan = planSpawn();
  if (!plan) {
    console.warn(
      "[agent-ts] no runnable launcher found — install bun (https://bun.sh) or ensure npx is on PATH",
    );
    return;
  }

  console.log(
    `[agent-ts] launching (${plan.description}): ${plan.command} ${plan.args.join(" ")}`,
  );

  const child = spawn(plan.command, plan.args, {
    cwd: plan.cwd,
    env: {
      ...process.env,
      AGENT_TS_HOST: host,
      AGENT_TS_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  child.stdout?.on("data", (chunk) => {
    process.stdout.write(`[agent-ts] ${chunk}`);
  });
  child.stderr?.on("data", (chunk) => {
    process.stderr.write(`[agent-ts] ${chunk}`);
  });
  child.on("exit", (code, signal) => {
    proc = null;
    if (signal === "SIGTERM" || isShuttingDown) return;
    console.warn(`[agent-ts] exited code=${code} signal=${signal}`);

    const now = Date.now();
    restarts = restarts.filter((t) => now - t < RESTART_WINDOW_MS);
    if (restarts.length >= RESTART_MAX) {
      console.error(
        `[agent-ts] giving up after ${RESTART_MAX} restarts in ${RESTART_WINDOW_MS / 1000}s`,
      );
      return;
    }
    restarts.push(now);
    console.log(
      `[agent-ts] restarting (${restarts.length}/${RESTART_MAX} this window)`,
    );
    setTimeout(() => launch(host, port), RESTART_DELAY_MS);
  });

  proc = child;
}

function repoRoot(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, "app");
  return path.resolve(__dirname, "..", "..");
}

function which(cmd: string): string | null {
  if (!cmd) return null;
  const sep = process.platform === "win32" ? ";" : ":";
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.BAT;.CMD").split(";")
      : [""];
  for (const dir of (process.env.PATH ?? "").split(sep)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, cmd + ext);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}
