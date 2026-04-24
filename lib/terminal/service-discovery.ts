import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

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

export function discoverTerminalServiceToken(port: string): string | null {
  if (process.platform !== "linux") return null;

  const ss = spawnSync("ss", ["-ltnp"], { encoding: "utf8" });
  if (ss.status !== 0 || !ss.stdout) return null;

  const pid = parseTerminalServicePid(ss.stdout, port);
  if (!pid) return null;

  try {
    const environ = readFileSync(`/proc/${pid}/environ`, "utf8");
    return extractEnvValue(environ, "TERMINAL_SERVICE_TOKEN");
  } catch {
    return null;
  }
}
