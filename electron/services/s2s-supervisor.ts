// Auto-spawn the speech-to-speech Voice Lab supervisor from Electron main.
// Skip if the lab port is already listening; restart up to 3x per 5 min; kill on quit.
// Spawn order: uv run speech-to-speech-lab -> repo .venv python module.

import { app } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import * as net from "node:net";
import * as path from "node:path";

const RESTART_MAX = 3;
const RESTART_WINDOW_MS = 5 * 60 * 1000;
const RESTART_DELAY_MS = 2_000;
const READINESS_TIMEOUT_MS = 30_000;
const READINESS_INTERVAL_MS = 500;
const DEFAULT_LAB_HOST = "127.0.0.1";
const DEFAULT_LAB_PORT = 7860;

export interface S2sSupervisorState {
  /** True once we've exhausted the restart budget and stopped trying. */
  gaveUp: boolean;
  /** How many restarts have happened inside the current rolling window. */
  restartCount: number;
  /** Last non-zero exit, if any - for surfacing in the UI when gaveUp=true. */
  lastExit: { code: number | null; signal: NodeJS.Signals | null; at: number } | null;
  /** True if a child is currently spawned. */
  running: boolean;
  /** True once the Voice Lab status endpoint has answered with a 2xx. */
  ready: boolean;
}

interface S2sProc {
  kill(): void;
  /** Inspect supervisor health for the UI / IPC bridge. */
  getState(): S2sSupervisorState;
  /**
   * Operator-initiated reset: clears the give-up state and restart history,
   * then relaunches if s2s is enabled and present. Returns the post-reset state.
   */
  restart(): S2sSupervisorState;
}

interface LabEndpoint {
  baseUrl: string;
  host: string;
  port: number;
}

let proc: ChildProcess | null = null;
let restarts: number[] = []; // timestamps within current window
let isShuttingDown = false;
let gaveUp = false;
let ready = false;
let readinessTimer: NodeJS.Timeout | null = null;
let lastExit: S2sSupervisorState["lastExit"] = null;
let lastEndpoint: LabEndpoint = defaultLabEndpoint();
let lastDir = defaultS2sDir();

function snapshot(): S2sSupervisorState {
  return {
    gaveUp,
    restartCount: restarts.length,
    lastExit,
    running: proc !== null && !proc.killed,
    ready,
  };
}

export function startS2sSupervisor(): S2sProc {
  const endpoint = resolveLabEndpoint();
  const dir = resolveS2sDir();
  lastEndpoint = endpoint;
  lastDir = dir;

  startIfAllowed(endpoint, dir);

  return {
    kill() {
      isShuttingDown = true;
      clearReadinessTimer();
      ready = false;
      if (proc && !proc.killed) {
        try {
          proc.kill("SIGTERM");
        } catch {
          /* ignore */
        }
      }
      proc = null;
    },
    getState: snapshot,
    restart() {
      console.log("[s2s] operator restart: clearing give-up state");
      isShuttingDown = false;
      gaveUp = false;
      restarts = [];
      lastExit = null;
      ready = false;
      clearReadinessTimer();
      const hadOwnedProcess = proc !== null && !proc.killed;
      if (proc && !proc.killed) {
        try {
          proc.kill("SIGTERM");
        } catch {
          /* ignore */
        }
        proc = null;
      }
      const endpointNow = resolveLabEndpoint();
      const dirNow = resolveS2sDir();
      lastEndpoint = endpointNow;
      lastDir = dirNow;
      if (process.env.S2S_ENABLED === "0") {
        console.log("[s2s] S2S_ENABLED=0 - supervisor idle");
      } else if (!fs.existsSync(dirNow)) {
        console.log(`[s2s] S2S_DIR missing (${dirNow}) - supervisor idle`);
      } else if (hadOwnedProcess) {
        launch(endpointNow, dirNow);
      } else {
        startIfAllowed(endpointNow, dirNow);
      }
      return snapshot();
    },
  };
}

function startIfAllowed(endpoint: LabEndpoint, dir: string): void {
  if (process.env.S2S_ENABLED === "0") {
    console.log("[s2s] S2S_ENABLED=0 - supervisor idle");
    return;
  }

  if (!fs.existsSync(dir)) {
    console.log(`[s2s] S2S_DIR missing (${dir}) - supervisor idle`);
    return;
  }

  isPortListening(endpoint.port, endpoint.host).then((listening) => {
    if (isShuttingDown) return;
    if (listening) {
      console.log(
        `[s2s] Voice Lab port ${endpoint.port} already listening - assuming prior instance, not spawning`,
      );
      pollReadiness(endpoint.baseUrl, true);
      return;
    }
    launch(endpoint, dir);
  });
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

function planSpawn(dir: string, endpoint: LabEndpoint): SpawnPlan | null {
  if (!fs.existsSync(path.join(dir, "pyproject.toml"))) return null;

  const serveArgs = ["--host", endpoint.host, "--port", String(endpoint.port)];

  // 1. Prefer `uv run --directory <S2S_DIR> speech-to-speech-lab`.
  const uvBin = which("uv");
  if (uvBin) {
    return {
      command: uvBin,
      args: ["run", "--directory", dir, "speech-to-speech-lab", ...serveArgs],
      cwd: dir,
      description: "uv run speech-to-speech-lab",
    };
  }

  // 2. Fall back to the project-local `.venv/bin/python`.
  const venvPython =
    process.platform === "win32"
      ? path.join(dir, ".venv", "Scripts", "python.exe")
      : path.join(dir, ".venv", "bin", "python");
  if (fs.existsSync(venvPython)) {
    return {
      command: venvPython,
      args: ["-m", "speech_to_speech.api.voice_lab.server", ...serveArgs],
      cwd: dir,
      description: ".venv python voice_lab.server",
    };
  }

  return null;
}

function launch(endpoint: LabEndpoint, dir: string): void {
  const plan = planSpawn(dir, endpoint);
  if (!plan) {
    console.warn(
      "[s2s] no runnable Voice Lab launcher found - install uv or run `uv sync` inside S2S_DIR",
    );
    return;
  }

  console.log(
    `[s2s] launching (${plan.description}): ${plan.command} ${plan.args.join(" ")}`,
  );

  ready = false;
  const child = spawn(plan.command, plan.args, {
    cwd: plan.cwd,
    env: {
      ...process.env,
      S2S_DIR: dir,
      S2S_LAB_URL: endpoint.baseUrl,
      // Pin model cache next to other model state.
      HF_HOME:
        process.env.HF_HOME ?? path.join(app.getPath("home"), ".cache", "huggingface"),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  child.stdout?.on("data", (chunk) => {
    process.stdout.write(`[s2s] ${chunk}`);
  });
  child.stderr?.on("data", (chunk) => {
    process.stderr.write(`[s2s] ${chunk}`);
  });
  child.on("exit", (code, signal) => {
    if (proc === child) {
      proc = null;
      ready = false;
      clearReadinessTimer();
    }
    if (signal === "SIGTERM" || isShuttingDown) return;
    console.warn(`[s2s] exited code=${code} signal=${signal}`);
    lastExit = { code, signal, at: Date.now() };

    const now = Date.now();
    restarts = restarts.filter((t) => now - t < RESTART_WINDOW_MS);
    if (restarts.length >= RESTART_MAX) {
      gaveUp = true;
      console.error(
        `[s2s] giving up after ${RESTART_MAX} restarts in ${RESTART_WINDOW_MS / 1000}s - call restart() to retry`,
      );
      return;
    }
    restarts.push(now);
    console.log(
      `[s2s] restarting (${restarts.length}/${RESTART_MAX} this window)`,
    );
    setTimeout(() => {
      if (process.env.S2S_ENABLED !== "0") launch(lastEndpoint, lastDir);
    }, RESTART_DELAY_MS);
  });

  proc = child;
  pollReadiness(endpoint.baseUrl, false);
}

function pollReadiness(baseUrl: string, allowExternal: boolean): void {
  clearReadinessTimer();
  const statusUrl = `${trimTrailingSlash(baseUrl)}/v1/voice-lab/status`;
  const deadline = Date.now() + READINESS_TIMEOUT_MS;

  const tick = async (): Promise<void> => {
    if (isShuttingDown || (!allowExternal && (proc === null || proc.killed))) return;
    const ok = await probe2xx(statusUrl);
    if (isShuttingDown || (!allowExternal && (proc === null || proc.killed))) return;
    if (ok) {
      ready = true;
      console.log(`[s2s] Voice Lab ready at ${statusUrl}`);
      return;
    }
    if (Date.now() >= deadline) {
      console.warn(`[s2s] Voice Lab did not become ready at ${statusUrl}`);
      return;
    }
    readinessTimer = setTimeout(() => {
      tick().catch((err) => {
        console.warn("[s2s] readiness probe failed:", err);
      });
    }, READINESS_INTERVAL_MS);
  };

  tick().catch((err) => {
    console.warn("[s2s] readiness probe failed:", err);
  });
}

function probe2xx(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      done(false);
      return;
    }

    const client = parsed.protocol === "https:" ? https : http;
    const req = client.request(parsed, { method: "GET", timeout: 1_000 }, (res) => {
      res.resume();
      const statusCode = res.statusCode ?? 0;
      done(statusCode >= 200 && statusCode < 300);
    });
    req.once("timeout", () => {
      req.destroy();
      done(false);
    });
    req.once("error", () => {
      done(false);
    });
    req.end();
  });
}

function clearReadinessTimer(): void {
  if (!readinessTimer) return;
  clearTimeout(readinessTimer);
  readinessTimer = null;
}

function resolveLabEndpoint(): LabEndpoint {
  const raw = process.env.S2S_LAB_URL ?? defaultLabEndpoint().baseUrl;
  try {
    const url = new URL(raw);
    const fallbackPort = url.protocol === "https:" ? 443 : 80;
    const port = Number(url.port || fallbackPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`invalid port: ${url.port}`);
    }
    return {
      baseUrl: trimTrailingSlash(raw),
      host: url.hostname.replace(/^\[/, "").replace(/\]$/, ""),
      port,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn(`[s2s] invalid S2S_LAB_URL (${raw}): ${detail}; using default`);
    return defaultLabEndpoint();
  }
}

function resolveS2sDir(): string {
  return process.env.S2S_DIR ?? defaultS2sDir();
}

function defaultLabEndpoint(): LabEndpoint {
  return {
    baseUrl: `http://${DEFAULT_LAB_HOST}:${DEFAULT_LAB_PORT}`,
    host: DEFAULT_LAB_HOST,
    port: DEFAULT_LAB_PORT,
  };
}

function defaultS2sDir(): string {
  return path.join(
    app.getPath("home"),
    "Documents",
    "Project",
    "footydata",
    "speech-to-speech",
  );
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
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
