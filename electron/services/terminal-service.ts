/**
 * Auto-spawn scripts/terminal-service.ts from Electron main so the
 * terminal pane Just Works — no `bun run terminal-service` required.
 *
 * Strategy:
 *   dev:  spawn via repo-local `node_modules/.bin/tsx` (cross-platform shim).
 *   pack: spawn a pre-compiled JS bundle staged at
 *         `resources/app/scripts/terminal-service.js` (see
 *         electron:build for the build step).
 *
 * If launch fails (tsx missing, port in use, etc.) the UI will just
 * keep showing "terminal service offline" — no crash, no blocking.
 */

import { app } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";

interface TerminalServiceProc {
  kill(): void;
}

let proc: ChildProcess | null = null;
let restartCount = 0;
const RESTART_MAX = 3;
const RESTART_DELAY_MS = 2_000;

export function startTerminalService(): TerminalServiceProc {
  const port = Number(process.env.TERMINAL_SERVICE_PORT ?? "4010");
  isPortListening(port, "127.0.0.1").then((listening) => {
    if (listening) {
      console.log(
        `[terminal-service] port ${port} already listening — assuming prior instance, not spawning`,
      );
      return;
    }
    launch();
  });

  return {
    kill() {
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

function launch(): void {
  const repoRoot = resolveRepoRoot();
  const terminalScript = resolveTerminalScript(repoRoot);
  if (!terminalScript) {
    console.warn(
      "[terminal-service] script not found — terminal pane will stay offline",
    );
    return;
  }

  const { command, args } = buildCommand(terminalScript, repoRoot);
  if (!command) {
    console.warn(
      "[terminal-service] tsx runner not found — run `bun install`, then restart Electron",
    );
    return;
  }

  console.log(`[terminal-service] launching: ${command} ${args.join(" ")}`);

  const child = spawn(command, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      TERMINAL_SERVICE_HOST: process.env.TERMINAL_SERVICE_HOST ?? "127.0.0.1",
      TERMINAL_SERVICE_PORT: process.env.TERMINAL_SERVICE_PORT ?? "4010",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    // tsx spawns a child node process; without `shell:true` the .cmd
    // shim on Windows can fail to resolve. On POSIX shell:true is
    // harmless.
    shell: process.platform === "win32",
  });

  child.stdout?.on("data", (chunk) => {
    process.stdout.write(`[terminal-service] ${chunk}`);
  });
  child.stderr?.on("data", (chunk) => {
    process.stderr.write(`[terminal-service] ${chunk}`);
  });
  child.on("exit", (code, signal) => {
    proc = null;
    if (signal === "SIGTERM") return; // intentional shutdown
    console.warn(`[terminal-service] exited code=${code} signal=${signal}`);
    if (restartCount < RESTART_MAX) {
      restartCount++;
      console.log(`[terminal-service] restarting (${restartCount}/${RESTART_MAX})`);
      setTimeout(launch, RESTART_DELAY_MS);
    } else {
      console.error(
        `[terminal-service] giving up after ${RESTART_MAX} restart attempts`,
      );
    }
  });

  proc = child;
}

function resolveRepoRoot(): string {
  // In dev: electron/.electron-dist/main.js → repo root is two levels up
  // In pack: .../resources/app.asar or resources/app → use process.resourcesPath
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "app");
  }
  return path.resolve(__dirname, "..", "..");
}

function resolveTerminalScript(repoRoot: string): string | null {
  const candidates = app.isPackaged
    ? [
        // Production: pre-compiled JS (requires build-step; TODO).
        path.join(repoRoot, "scripts", "terminal-service.js"),
        path.join(repoRoot, "scripts", "terminal-service.ts"),
      ]
    : [
        path.join(repoRoot, "scripts", "terminal-service.ts"),
      ];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function buildCommand(
  scriptPath: string,
  repoRoot: string,
): { command: string | null; args: string[] } {
  // Production: pre-compiled JS runs under Electron-as-Node.
  if (scriptPath.endsWith(".js")) {
    return {
      command: process.execPath,
      args: [scriptPath],
    };
  }

  // Dev: tsx shim from node_modules/.bin. Bun installs as .exe, npm
  // installs as .cmd; check both.
  const binDir = path.join(repoRoot, "node_modules", ".bin");
  const candidates = process.platform === "win32"
    ? ["tsx.exe", "tsx.cmd", "tsx"]
    : ["tsx"];
  for (const name of candidates) {
    const p = path.join(binDir, name);
    if (fs.existsSync(p)) {
      return { command: p, args: [scriptPath] };
    }
  }
  return { command: null, args: [] };
}
