/**
 * Auto-spawn `scripts/voice-engines-sidecar.py` from Electron main when the
 * persisted slot bindings indicate a tier was installed. Mirrors the
 * `terminal-service.ts` pattern: skip if the port is already listening,
 * restart on crash up to 3 times in 5 minutes, kill on app quit.
 *
 * Tier read from `${userData}/inference-bindings.json` (or `./data/...` in
 * dev) — same precedence rules as `lib/inference/persistence.ts`.
 */

import { app } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";

const RESTART_MAX = 3;
const RESTART_WINDOW_MS = 5 * 60 * 1000;
const RESTART_DELAY_MS = 2_000;

interface VoiceEnginesProc {
  kill(): void;
}

let proc: ChildProcess | null = null;
let restarts: number[] = []; // timestamps within current window
let isShuttingDown = false;

interface PersistedBindings {
  selectedTier?: string;
}

export function startVoiceEnginesSupervisor(): VoiceEnginesProc {
  const persisted = readPersistedTier();
  if (!persisted) {
    console.log(
      "[voice-engines] no tier installed yet — supervisor idle (TierPicker will start the sidecar after first pull)",
    );
  }

  const host = process.env.VOICE_ENGINES_HOST ?? "127.0.0.1";
  const port = Number(process.env.VOICE_ENGINES_PORT ?? "9101");

  isPortListening(port, host).then((listening) => {
    if (listening) {
      console.log(
        `[voice-engines] port ${port} already listening — assuming prior instance, not spawning`,
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

function launch(host: string, port: number, tier: string): void {
  const root = repoRoot();
  const script = resolveScript(root);
  if (!script) {
    console.warn(
      "[voice-engines] scripts/voice-engines-sidecar.py not found — sidecar disabled",
    );
    return;
  }

  const python = resolvePython();
  if (!python) {
    console.warn(
      "[voice-engines] python3 not on PATH — install python and the voice-* extras to enable the sidecar",
    );
    return;
  }

  const args = [script, "--host", host, "--port", String(port), "--tier", tier];
  console.log(`[voice-engines] launching: ${python} ${args.join(" ")}`);

  const child = spawn(python, args, {
    cwd: root,
    env: {
      ...process.env,
      VOICE_ENGINES_HOST: host,
      VOICE_ENGINES_PORT: String(port),
      VOICE_ENGINES_TIER: tier,
      // Encourage HF cache to live next to other model state.
      HF_HOME:
        process.env.HF_HOME ?? path.join(app.getPath("home"), ".cache", "huggingface"),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  child.stdout?.on("data", (chunk) => {
    process.stdout.write(`[voice-engines] ${chunk}`);
  });
  child.stderr?.on("data", (chunk) => {
    process.stderr.write(`[voice-engines] ${chunk}`);
  });
  child.on("exit", (code, signal) => {
    proc = null;
    if (signal === "SIGTERM" || isShuttingDown) return;
    console.warn(
      `[voice-engines] exited code=${code} signal=${signal}`,
    );

    const now = Date.now();
    restarts = restarts.filter((t) => now - t < RESTART_WINDOW_MS);
    if (restarts.length >= RESTART_MAX) {
      console.error(
        `[voice-engines] giving up after ${RESTART_MAX} restarts in ${RESTART_WINDOW_MS / 1000}s`,
      );
      return;
    }
    restarts.push(now);
    console.log(
      `[voice-engines] restarting (${restarts.length}/${RESTART_MAX} this window)`,
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

function resolveScript(root: string): string | null {
  const candidates = app.isPackaged
    ? [path.join(root, "scripts", "voice-engines-sidecar.py")]
    : [path.join(root, "scripts", "voice-engines-sidecar.py")];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function resolvePython(): string | null {
  const explicit = process.env.VOICE_ENGINES_PYTHON;
  if (explicit && fs.existsSync(explicit)) return explicit;

  // Prefer a project venv if one exists (Electron supplies these in dev).
  const root = repoRoot();
  const venvCandidates = process.platform === "win32"
    ? [path.join(root, ".venv", "Scripts", "python.exe")]
    : [
        path.join(root, ".venv", "bin", "python3"),
        path.join(root, ".venv", "bin", "python"),
      ];
  for (const c of venvCandidates) {
    if (fs.existsSync(c)) return c;
  }

  // Fall back to system python.
  return process.platform === "win32" ? "python" : "python3";
}
