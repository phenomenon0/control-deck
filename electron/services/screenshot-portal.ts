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
import { runPythonJsonHelper } from "./python-json-helper";

const CAPTURE_TIMEOUT_MS = 120_000; // generous: first call waits for user click
const HELPER_PATH = path.resolve(__dirname, "..", "..", "scripts", "screenshot-capture.py");

export interface ScreenshotResult {
  pngPath: string;
  width: number;
  height: number;
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
    const result = await runPythonJsonHelper<HelperResult>(HELPER_PATH, [pngPath], {
      timeoutMs: CAPTURE_TIMEOUT_MS,
      label: "screenshot",
    });
    if (!result.ok) throw new Error(result.error || "screenshot portal capture failed");
    if (!fs.existsSync(result.path)) {
      throw new Error(`helper reported success but no file at ${result.path}`);
    }
    return { pngPath: result.path, width: result.width, height: result.height };
  }
}
