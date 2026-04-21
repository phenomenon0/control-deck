/**
 * Wayland focus-raise bridge.
 *
 * Shells out to `scripts/wl-activate.py`, which mints a real
 * xdg_activation_v1 token from a GTK4 helper window (satisfying Mutter's
 * `token_can_activate` requirement) and hands it to the target
 * application's `org.freedesktop.Application.Activate` D-Bus method.
 *
 * TODO(perf): replace with an in-process GDK native addon
 * (`electron/native/gdk-activator/`) to save ~150 ms/call by avoiding the
 * Python interpreter spawn. The addon would call
 * `Gdk.AppLaunchContext.get_startup_notify_id()` from Electron main's GLib
 * main loop instead. Tool surface remains unchanged.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const DEFAULT_TIMEOUT_MS = 5_000;

function resolveScriptsDir(): string {
  const envDir = process.env.CONTROL_DECK_SCRIPTS_DIR;
  if (envDir && fs.existsSync(envDir)) return envDir;
  const candidates = [
    path.join(process.cwd(), "scripts"),
    path.join(__dirname, "..", "..", "scripts"),
    path.join(__dirname, "..", "..", "..", "scripts"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "wl-activate.py"))) return c;
  }
  return candidates[0];
}

function findDesktopFile(appId: string): string | null {
  const dirs = [
    path.join(process.env.HOME ?? "", ".local", "share", "applications"),
    "/var/lib/flatpak/exports/share/applications",
    "/usr/share/applications",
    "/usr/local/share/applications",
  ].filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, `${appId}.desktop`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export interface FocusResult {
  /** Whether the helper exited 0 — doesn't guarantee the compositor honoured it. */
  dispatched: boolean;
  /** Stdout from the helper (contains dispatch log lines). */
  log: string;
}

export async function focusApp(appId: string): Promise<FocusResult> {
  const scriptsDir = resolveScriptsDir();
  const script = path.join(scriptsDir, "wl-activate.py");
  if (!fs.existsSync(script)) {
    throw new Error(`wl-activate.py not found at ${script}`);
  }

  const desktopPath = findDesktopFile(appId);
  const args = [script, appId];
  if (desktopPath) args.push(desktopPath);

  return new Promise((resolve, reject) => {
    const proc = spawn("python3", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("wl-activate helper timed out"));
    }, DEFAULT_TIMEOUT_MS);

    proc.stdout.on("data", (c) => (stdout += c.toString("utf8")));
    proc.stderr.on("data", (c) => (stderr += c.toString("utf8")));
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `wl-activate exited ${code}`));
        return;
      }
      resolve({ dispatched: true, log: stdout.trim() });
    });
  });
}
