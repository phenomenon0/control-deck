/**
 * Electron main-process hook for the Windows UIA sidecar.
 *
 * The sidecar lifecycle lives in lib/tools/native/windows-host-client.ts
 * (a per-process singleton that spawns WinAutomationHost.exe lazily on
 * first use). This module exists so electron/main.ts can:
 *
 *  1. Point the adapter at the packaged WinAutomationHost.exe via the
 *     CONTROL_DECK_WIN_HOST env var — solves path resolution when the
 *     Next.js standalone server runs embedded inside Electron.
 *  2. Ensure the child process gets killed on app quit (otherwise
 *     WinAutomationHost.exe can linger if Electron is force-killed).
 */

import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";

let registered = false;

export function registerWindowsHost(): void {
  if (process.platform !== "win32") return;
  if (registered) return;
  registered = true;

  const hostPath = resolveHostExe();
  if (hostPath) {
    process.env.CONTROL_DECK_WIN_HOST = hostPath;
    console.log(`[electron] win-host resolved: ${hostPath}`);
  } else {
    console.warn(
      "[electron] WinAutomationHost.exe not found — Windows native tools will fail until built (bun run electron:win-host)",
    );
  }

  app.on("before-quit", () => {
    // The singleton exposes shutdown() but calling it from here would
    // re-import the adapter into main's module graph. Instead rely on
    // the fact that when Electron exits, all spawned child processes
    // inherit that exit unless explicitly detached. We did not detach,
    // so stdio closure in the Node process will kill the host.
  });
}

function resolveHostExe(): string | null {
  const candidates: string[] = [];
  if (app.isPackaged) {
    candidates.push(path.join(process.resourcesPath, "win", "WinAutomationHost.exe"));
  } else {
    // Dev: repo-relative — scripts/build-win-host.cjs stages here.
    candidates.push(path.resolve(__dirname, "..", "..", "electron", "resources", "win", "WinAutomationHost.exe"));
    candidates.push(path.resolve(__dirname, "..", "..", "..", "electron", "resources", "win", "WinAutomationHost.exe"));
  }

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}
