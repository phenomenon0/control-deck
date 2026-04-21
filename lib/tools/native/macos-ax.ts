/**
 * macOS AX adapter — drives the system accessibility surface via a compiled
 * Swift helper (`scripts/macos-ax-helper.bin`). Same stdin-JSON / stdout-JSON
 * protocol as `scripts/atspi-helper.py`, keyed by op name.
 *
 * Input (`key`, `typeText`, `clickPixel`) is dispatched through the same
 * helper rather than a Node-side CGEvent shim: every CGEvent call already
 * requires Accessibility permission, and the Swift binary gets that trust
 * inherited from the Electron main process that spawned it.
 *
 * Screen capture shells out to the built-in `/usr/sbin/screencapture` — no
 * extra dep, no portal equivalent needed, and Screen Recording permission
 * is handled by macOS.
 */

import { spawn } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type {
  ClickPixelArgs,
  ClickResult,
  FocusWindowResult,
  KeyEvent,
  LocateQuery,
  NativeAdapter,
  NodeHandle,
  ScreenGrabResult,
  TreeNode,
} from "./types";

const HELPER_TIMEOUT_MS = 5_000;

interface HelperResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

type HelperOp =
  | "available"
  | "locate"
  | "click"
  | "type"
  | "tree"
  | "key"
  | "focus"
  | "focus_window"
  | "click_pixel";

interface HelperCommand {
  op: HelperOp;
  query?: LocateQuery;
  handle?: NodeHandle;
  text?: string;
  key?: string;
  app_id?: string;
  x?: number;
  y?: number;
  button?: "left" | "right" | "middle";
  depth?: number;
}

function resolveHelper(): string {
  const candidates = [
    process.env.CONTROL_DECK_MACOS_HELPER || null,
    process.env.CONTROL_DECK_SCRIPTS_DIR
      ? path.join(process.env.CONTROL_DECK_SCRIPTS_DIR, "macos-ax-helper.bin")
      : null,
    path.join(process.cwd(), "scripts", "macos-ax-helper.bin"),
    path.join(process.cwd(), "..", "scripts", "macos-ax-helper.bin"),
    path.join(process.cwd(), "..", "..", "scripts", "macos-ax-helper.bin"),
  ].filter((p): p is string => Boolean(p));
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0] ?? path.join(process.cwd(), "scripts", "macos-ax-helper.bin");
}

const HELPER = resolveHelper();

async function runHelper<T>(cmd: HelperCommand): Promise<HelperResult<T>> {
  return new Promise((resolve) => {
    const proc = spawn(HELPER, [], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      resolve({ ok: false, error: "macos-ax helper timed out" });
    }, HELPER_TIMEOUT_MS);

    proc.stdout.on("data", (chunk) => (stdout += chunk.toString("utf8")));
    proc.stderr.on("data", (chunk) => (stderr += chunk.toString("utf8")));
    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: err.message });
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && !stdout) {
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
          error: `invalid helper output: ${err instanceof Error ? err.message : err}; stderr: ${stderr.trim()}`,
        });
      }
    });

    proc.stdin.write(JSON.stringify(cmd));
    proc.stdin.end();
  });
}

function screenCapturePath(): string {
  return path.join(os.tmpdir(), `control-deck-grab-${crypto.randomBytes(6).toString("hex")}.png`);
}

function readPngDimensions(pngPath: string): { width: number; height: number } {
  // Same two-field read trick used in electron/services/remote-desktop.ts:477-492
  // — avoids pulling sharp just for IHDR parsing.
  const fd = fs.openSync(pngPath, "r");
  try {
    const header = Buffer.alloc(24);
    fs.readSync(fd, header, 0, 24, 0);
    if (header.toString("ascii", 1, 4) !== "PNG") {
      throw new Error("not a PNG");
    }
    return {
      width: header.readUInt32BE(16),
      height: header.readUInt32BE(20),
    };
  } finally {
    fs.closeSync(fd);
  }
}

async function captureScreen(): Promise<{ pngPath: string; width: number; height: number }> {
  const out = screenCapturePath();
  return new Promise((resolve, reject) => {
    // -x = silent (no shutter sound), -t png = PNG format.
    const proc = spawn("/usr/sbin/screencapture", ["-x", "-t", "png", out]);
    let stderr = "";
    proc.stderr.on("data", (c: Buffer) => (stderr += c.toString("utf8")));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        const msg = stderr.trim();
        // macOS TCC returns this exact string when Screen Recording is not
        // granted — translate to something actionable.
        if (/could not create image from display/i.test(msg)) {
          reject(
            new Error(
              "native_screen_grab: Screen Recording permission required. " +
                "Grant it in System Settings → Privacy & Security → Screen Recording, " +
                "then relaunch Control Deck.",
            ),
          );
          return;
        }
        reject(new Error(`screencapture exited ${code}: ${msg}`));
        return;
      }
      if (!fs.existsSync(out) || fs.statSync(out).size === 0) {
        reject(new Error("screencapture produced no output (permission denied?)"));
        return;
      }
      try {
        resolve({ pngPath: out, ...readPngDimensions(out) });
      } catch (err) {
        reject(err);
      }
    });
  });
}

export const macosAxAdapter: NativeAdapter = {
  platform: "darwin",

  async isAvailable() {
    const res = await runHelper<{ trusted?: boolean }>({ op: "available" });
    if (!res.ok) return false;
    return Boolean(res.data?.trusted);
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
    const cmd: HelperCommand = { op: "type", text };
    if (handle) cmd.handle = handle;
    const res = await runHelper({ op: "type", text, handle: handle ?? undefined });
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

  async screenGrab(): Promise<ScreenGrabResult> {
    const { pngPath, width, height } = await captureScreen();
    const data = fs.readFileSync(pngPath);
    try {
      fs.unlinkSync(pngPath);
    } catch {
      /* best effort */
    }
    return { pngBase64: data.toString("base64"), width, height };
  },

  async focusWindow(appId): Promise<FocusWindowResult> {
    const res = await runHelper<{ dispatched?: boolean; log?: string }>({
      op: "focus_window",
      app_id: appId,
    });
    if (!res.ok) throw new Error(res.error ?? "focus_window failed");
    return {
      dispatched: Boolean(res.data?.dispatched),
      log: res.data?.log ?? "",
    };
  },

  async clickPixel(args: ClickPixelArgs): Promise<void> {
    const res = await runHelper({
      op: "click_pixel",
      x: args.x,
      y: args.y,
      button: args.button ?? "left",
    });
    if (!res.ok) throw new Error(res.error ?? "click_pixel failed");
  },
};
