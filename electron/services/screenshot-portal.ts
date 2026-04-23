/**
 * xdg-desktop-portal Screenshot client — one-shot full-desktop PNG capture.
 *
 * Used over ScreenCast for stateless grabs: Screenshot.Screenshot() is a
 * single Request round-trip (~50–200 ms), no PipeWire client required.
 * Reserve ScreenCast for the lazy warm session that absolute-coord pointer
 * injection needs.
 *
 * Why this spawns Python instead of using dbus-next directly: on Electron 41
 * / Node 24, dbus-next's session-bus proxy hangs or SIGTRAPs (NAN-based
 * `usocket` addon is incompatible with the newer V8 / Node ABI when the
 * handshake exchanges FDs). Python's dbus-python stack works reliably, so
 * we shell out to scripts/screenshot-capture.py per grab.
 *
 * Spec: https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.Screenshot.html
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { spawn } from "node:child_process";

const CAPTURE_TIMEOUT_MS = 120_000; // generous: first call waits for user click
const HELPER_PATH = path.resolve(__dirname, "..", "..", "scripts", "screenshot-capture.py");

export interface ScreenshotResult {
  pngPath: string;
  width: number;
  height: number;
}

export class ScreenshotPortal {
  async init(): Promise<void> {
    if (!fs.existsSync(HELPER_PATH)) {
      throw new Error(`screenshot helper missing at ${HELPER_PATH}`);
    }
  }

  async captureOne(): Promise<ScreenshotResult> {
    await this.init();
    const pngPath = path.join(
      os.tmpdir(),
      `control-deck-shot-${crypto.randomBytes(6).toString("hex")}.png`,
    );
    const result = await runHelper(pngPath);
    if (!result.ok) throw new Error(result.error || "screenshot portal capture failed");
    if (!fs.existsSync(result.path)) {
      throw new Error(`helper reported success but no file at ${result.path}`);
    }
    return { pngPath: result.path, width: result.width, height: result.height };
  }
}

interface HelperSuccess {
  ok: true;
  path: string;
  width: number;
  height: number;
}
interface HelperFailure {
  ok: false;
  error?: string;
}
type HelperResult = HelperSuccess | HelperFailure;

async function runHelper(pngPath: string): Promise<HelperResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn("python3", [HELPER_PATH, pngPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (c: Buffer) => (stdout += c.toString("utf8")));
    proc.stderr?.on("data", (c: Buffer) => (stderr += c.toString("utf8")));
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("screenshot-capture.py timed out"));
    }, CAPTURE_TIMEOUT_MS);
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      const firstLine = stdout.split(/\r?\n/).find((l) => l.trim().startsWith("{"));
      if (!firstLine) {
        reject(
          new Error(
            `screenshot helper produced no JSON (exit=${code}): ${stderr.trim()}`,
          ),
        );
        return;
      }
      try {
        const parsed = JSON.parse(firstLine) as HelperResult;
        resolve(parsed);
      } catch (err) {
        reject(
          new Error(
            `screenshot helper returned invalid JSON: ${firstLine} / ${String(err)}`,
          ),
        );
      }
    });
  });
}
