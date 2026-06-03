import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

/**
 * Discover the running terminal-service's auth token from the OS, so the Next
 * `/api/terminal/config` route can hand it to a web (non-Electron) renderer in
 * local dev. The route is loopback-gated, and reading a process's own env is the
 * same posture on every platform — this just brings macOS to parity with Linux
 * (which already read it from /proc).
 *
 * Linux:  `ss -ltnp` → pid on the port → /proc/<pid>/environ (NUL-separated).
 * macOS:  `lsof` → pid on the port → `ps eww` (space-separated env on argv).
 */

export function parseTerminalServicePid(ssOutput: string, port: string): string | null {
  const lines = ssOutput.split(/\r?\n/);
  for (const line of lines) {
    if (!line.includes(`:${port}`)) continue;
    const match = line.match(/pid=(\d+)/);
    if (match) return match[1];
  }
  return null;
}

export function extractEnvValue(environ: string, key: string): string | null {
  const prefix = `${key}=`;
  for (const entry of environ.split("\0")) {
    if (entry.startsWith(prefix)) {
      return entry.slice(prefix.length);
    }
  }
  return null;
}

/** Extract TERMINAL_SERVICE_TOKEN from `ps eww` output (space-separated argv+env). */
export function extractEnvValueFromPs(psOutput: string, key: string): string | null {
  const match = psOutput.match(new RegExp(`(?:^|\\s)${key}=(\\S+)`));
  return match ? match[1] : null;
}

function findListenerPid(port: string): string | null {
  if (process.platform === "linux") {
    const ss = spawnSync("ss", ["-ltnp"], { encoding: "utf8" });
    if (ss.status !== 0 || !ss.stdout) return null;
    return parseTerminalServicePid(ss.stdout, port);
  }
  // macOS / BSD: lsof reports the pid holding the loopback listener.
  const lsof = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" });
  if (lsof.status !== 0 || !lsof.stdout) return null;
  return lsof.stdout.split(/\s+/).filter(Boolean)[0] ?? null;
}

function readProcessToken(pid: string): string | null {
  if (process.platform === "linux") {
    try {
      return extractEnvValue(readFileSync(`/proc/${pid}/environ`, "utf8"), "TERMINAL_SERVICE_TOKEN");
    } catch {
      return null;
    }
  }
  // macOS: `ps eww` prints the process environment alongside its command line.
  const ps = spawnSync("ps", ["eww", "-o", "command=", pid], { encoding: "utf8" });
  if (ps.status !== 0 || !ps.stdout) return null;
  return extractEnvValueFromPs(ps.stdout, "TERMINAL_SERVICE_TOKEN");
}

export function discoverTerminalServiceToken(port: string): string | null {
  const pid = findListenerPid(port);
  if (!pid) return null;
  return readProcessToken(pid);
}
