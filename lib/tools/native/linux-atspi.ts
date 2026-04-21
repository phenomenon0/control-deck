/**
 * Linux AT-SPI adapter — drives GTK/Qt apps via the accessibility bus.
 *
 * Uses a small python `pyatspi` helper shelled out per call. We do the
 * heavy lifting in python because pyatspi's bindings are stable and
 * there is no maintained node equivalent as of early 2026.
 *
 * The helper is expected at `scripts/atspi-helper.py` and takes a JSON
 * command on stdin, prints a JSON result on stdout.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type {
  ClickResult,
  KeyEvent,
  LocateQuery,
  NativeAdapter,
  NodeHandle,
  TreeNode,
} from "./types";

function resolveHelper(): string {
  const candidates = [
    process.env.CONTROL_DECK_SCRIPTS_DIR
      ? path.join(process.env.CONTROL_DECK_SCRIPTS_DIR, "atspi-helper.py")
      : null,
    path.join(process.cwd(), "scripts", "atspi-helper.py"),
    path.join(process.cwd(), "..", "scripts", "atspi-helper.py"),
    path.join(process.cwd(), "..", "..", "scripts", "atspi-helper.py"),
  ].filter((p): p is string => p !== null);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0] ?? path.join(process.cwd(), "scripts", "atspi-helper.py");
}

const HELPER = resolveHelper();
const HELPER_TIMEOUT_MS = 5_000;

interface HelperCommand {
  op: "locate" | "click" | "type" | "tree" | "available" | "key" | "focus";
  query?: LocateQuery;
  handle?: NodeHandle;
  text?: string;
  key?: string;
}

interface HelperResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

async function runHelper<T>(cmd: HelperCommand): Promise<HelperResult<T>> {
  return new Promise((resolve) => {
    const proc = spawn("python3", [HELPER], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      resolve({ ok: false, error: "atspi helper timed out" });
    }, HELPER_TIMEOUT_MS);

    proc.stdout.on("data", (chunk) => (stdout += chunk.toString("utf8")));
    proc.stderr.on("data", (chunk) => (stderr += chunk.toString("utf8")));
    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: err.message });
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolve({
          ok: false,
          error: stderr.trim() || `helper exited with code ${code}`,
        });
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as HelperResult<T>;
        resolve(parsed);
      } catch (err) {
        resolve({
          ok: false,
          error: `invalid helper output: ${err instanceof Error ? err.message : err}`,
        });
      }
    });

    proc.stdin.write(JSON.stringify(cmd));
    proc.stdin.end();
  });
}

export const linuxAtspiAdapter: NativeAdapter = {
  platform: "linux",

  async isAvailable() {
    const res = await runHelper<{ ok: boolean }>({ op: "available" });
    return res.ok === true;
  },

  async locate(query) {
    const res = await runHelper<NodeHandle[]>({ op: "locate", query });
    if (!res.ok) throw new Error(res.error ?? "locate failed");
    return res.data ?? [];
  },

  async click(handle): Promise<ClickResult> {
    const res = await runHelper<{ method?: ClickResult["method"] }>({ op: "click", handle });
    if (!res.ok) throw new Error(res.error ?? "click failed");
    return { method: res.data?.method ?? "unknown" };
  },

  async typeText(handle, text) {
    const res = await runHelper({
      op: "type",
      handle: handle ?? undefined,
      text,
    });
    if (!res.ok) throw new Error(res.error ?? "type failed");
  },

  async getTree(handle) {
    const res = await runHelper<TreeNode>({ op: "tree", handle });
    if (!res.ok) throw new Error(res.error ?? "tree failed");
    if (!res.data) throw new Error("empty tree response");
    return res.data;
  },

  async key(event: KeyEvent) {
    const res = await runHelper({ op: "key", key: event.key });
    if (!res.ok) throw new Error(res.error ?? "key failed");
  },

  async focus(handle) {
    const res = await runHelper<{ focused?: boolean }>({ op: "focus", handle });
    if (!res.ok) throw new Error(res.error ?? "focus failed");
    return Boolean(res.data?.focused);
  },
};
