/**
 * Shared runner for one-shot Python helpers that emit a single JSON line
 * on stdout. Used by screenshot-portal.ts and screencast.ts.
 *
 * Wire contract (helper side):
 *   - Exit with stdout containing at least one line starting with `{`.
 *   - First such line is parsed as the result.
 *   - Additional log lines (before or after) are ignored.
 *   - Exit code is NOT inspected — a well-formed failure JSON
 *     (`{"ok": false, "error": "..."}`) is the canonical error path.
 */

import { spawn } from "node:child_process";

export interface HelperOptions {
  /** Max wall-clock time before we SIGKILL the helper and reject. */
  timeoutMs: number;
  /** Short label for error messages, e.g. "screenshot", "screencast". */
  label: string;
  /** Command to exec. Defaults to "python3". Overridable for tests. */
  command?: string;
}

/**
 * Extract the first line from `stdout` whose trimmed prefix is `{`.
 * Returns the trimmed line, or `null` if no candidate is present.
 */
export function extractFirstJsonLine(stdout: string): string | null {
  for (const rawLine of stdout.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith("{")) return trimmed;
  }
  return null;
}

/**
 * Spawn `command helperPath ...args`, wait for it to exit, and return the
 * JSON result parsed from the first `{`-prefixed stdout line.
 *
 * Rejections:
 *  - Process fails to spawn (e.g. command missing) → proc "error" event.
 *  - Wall-clock timeout → SIGKILL + reject.
 *  - No JSON-looking line on stdout after exit → reject with exit code +
 *    captured stderr.
 *  - First JSON line fails JSON.parse → reject with the raw line.
 */
export async function runPythonJsonHelper<T>(
  helperPath: string,
  args: string[],
  opts: HelperOptions,
): Promise<T> {
  const command = opts.command ?? "python3";
  return new Promise<T>((resolve, reject) => {
    const proc = spawn(command, [helperPath, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (c: Buffer) => (stdout += c.toString("utf8")));
    proc.stderr?.on("data", (c: Buffer) => (stderr += c.toString("utf8")));
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`${opts.label} helper timed out`));
    }, opts.timeoutMs);
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      const firstLine = extractFirstJsonLine(stdout);
      if (!firstLine) {
        reject(
          new Error(
            `${opts.label} helper produced no JSON (exit=${code}): ${stderr.trim()}`,
          ),
        );
        return;
      }
      try {
        resolve(JSON.parse(firstLine) as T);
      } catch (err) {
        reject(
          new Error(
            `${opts.label} helper returned invalid JSON: ${firstLine} / ${String(err)}`,
          ),
        );
      }
    });
  });
}
