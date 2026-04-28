/**
 * Auto-spawn `apps/voice-core` from Electron main when the persisted slot
 * bindings indicate a tier was installed. Mirrors the `terminal-service.ts`
 * pattern: skip if the port is already listening, restart on crash up to 3
 * times in 5 minutes, kill on app quit.
 *
 * Tier read from `${userData}/inference-bindings.json` (or `./data/...` in
 * dev) — same precedence rules as `lib/inference/persistence.ts`.
 *
 * Spawn order:
 *   1. `uv run --directory apps/voice-core voice-core serve` (preferred)
 *   2. `<repo>/.venv-voice-core/bin/python -m voice_core serve` fallback
 *   3. system python3 from PATH if both above are missing
 */

import { app } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";

const RESTART_MAX = 3;
const RESTART_WINDOW_MS = 5 * 60 * 1000;
const RESTART_DELAY_MS = 2_000;

interface VoiceCoreProc {
  kill(): void;
}

let proc: ChildProcess | null = null;
let restarts: number[] = []; // timestamps within current window
let isShuttingDown = false;

interface PersistedBindings {
  selectedTier?: string;
}

export function startVoiceCoreSupervisor(): VoiceCoreProc {
  const persisted = readPersistedTier();
  if (!persisted) {
    console.log(
      "[voice-core] no tier installed yet — supervisor idle (TierPicker will start the sidecar after first pull)",
    );
  }

  const host = process.env.VOICE_CORE_HOST ?? "127.0.0.1";
  const port = Number(process.env.VOICE_CORE_PORT ?? "4245");

  isPortListening(port, host).then((listening) => {
    if (listening) {
      console.log(
        `[voice-core] port ${port} already listening — assuming prior instance, not spawning`,
      );
      return;
    }
    if (persisted) launch(host, port, persisted);
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

function readPersistedTier(): string | null {
  const base =
    process.env.CONTROL_DECK_USER_DATA ??
    (app.isPackaged ? app.getPath("userData") : path.join(repoRoot(), "data"));
  const file = path.join(base, "inference-bindings.json");
  try {
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(
      fs.readFileSync(file, "utf8"),
    ) as PersistedBindings;
    return typeof parsed.selectedTier === "string" ? parsed.selectedTier : null;
  } catch {
    return null;
  }
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

function planSpawn(host: string, port: number, tier: string): SpawnPlan | null {
  const root = repoRoot();
  const voiceCoreDir = path.join(root, "apps", "voice-core");
  if (!fs.existsSync(path.join(voiceCoreDir, "pyproject.toml"))) {
    return null;
  }

  const env = {
    HOST: host,
    PORT: String(port),
    TIER: tier,
  };
  const serveArgs = ["serve", "--host", env.HOST, "--port", env.PORT, "--tier", env.TIER];

  // 1. Prefer `uv run` if uv is on PATH.
  const uvBin = which("uv");
  if (uvBin) {
    return {
      command: uvBin,
      args: ["run", "--directory", voiceCoreDir, "voice-core", ...serveArgs],
      cwd: root,
      description: "uv run voice-core",
    };
  }

  // 2. Fall back to a project-local `.venv-voice-core/bin/python`.
  const venvPython =
    process.platform === "win32"
      ? path.join(root, ".venv-voice-core", "Scripts", "python.exe")
      : path.join(root, ".venv-voice-core", "bin", "python");
  if (fs.existsSync(venvPython)) {
    return {
      command: venvPython,
      args: ["-m", "voice_core", ...serveArgs],
      cwd: voiceCoreDir,
      description: ".venv-voice-core python",
    };
  }

  // 3. System python3 — only useful if the user already pip-installed the
  // package globally; mostly for debugging.
  const sys = which(process.platform === "win32" ? "python" : "python3");
  if (sys) {
    return {
      command: sys,
      args: ["-m", "voice_core", ...serveArgs],
      cwd: voiceCoreDir,
      description: "system python",
    };
  }

  return null;
}

function launch(host: string, port: number, tier: string): void {
  const plan = planSpawn(host, port, tier);
  if (!plan) {
    console.warn(
      "[voice-core] no runnable interpreter found — install uv (https://astral.sh/uv) or run `uv sync` inside apps/voice-core/",
    );
    return;
  }

  console.log(
    `[voice-core] launching (${plan.description}): ${plan.command} ${plan.args.join(" ")}`,
  );

  const child = spawn(plan.command, plan.args, {
    cwd: plan.cwd,
    env: {
      ...process.env,
      VOICE_CORE_HOST: host,
      VOICE_CORE_PORT: String(port),
      VOICE_CORE_TIER: tier,
      // Pin model cache next to other model state.
      HF_HOME:
        process.env.HF_HOME ?? path.join(app.getPath("home"), ".cache", "huggingface"),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  child.stdout?.on("data", (chunk) => {
    process.stdout.write(`[voice-core] ${chunk}`);
  });
  child.stderr?.on("data", (chunk) => {
    process.stderr.write(`[voice-core] ${chunk}`);
  });
  child.on("exit", (code, signal) => {
    proc = null;
    if (signal === "SIGTERM" || isShuttingDown) return;
    console.warn(`[voice-core] exited code=${code} signal=${signal}`);

    const now = Date.now();
    restarts = restarts.filter((t) => now - t < RESTART_WINDOW_MS);
    if (restarts.length >= RESTART_MAX) {
      console.error(
        `[voice-core] giving up after ${RESTART_MAX} restarts in ${RESTART_WINDOW_MS / 1000}s`,
      );
      return;
    }
    restarts.push(now);
    console.log(
      `[voice-core] restarting (${restarts.length}/${RESTART_MAX} this window)`,
    );
    setTimeout(() => {
      const tierNow = readPersistedTier();
      if (tierNow) launch(host, port, tierNow);
    }, RESTART_DELAY_MS);
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
  const exts = process.platform === "win32"
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
