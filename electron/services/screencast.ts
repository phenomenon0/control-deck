/**
 * ScreenCast portal capture — silent after first accept.
 *
 * Why this spawns Python instead of using dbus-next directly: on Electron 41
 * / Node 24, dbus-next's session-bus proxy hangs or SIGTRAPs (NAN-based
 * `usocket` addon is incompatible with the newer V8 / Node ABI when the
 * handshake exchanges FDs). Python's dbus-python stack works reliably, so we
 * shell out to scripts/screencast-capture.py per grab. A persistent
 * restore-token makes second+ calls silent — no dialog, no permission prompt.
 *
 * Flow (per capture):
 *   1. Python reads portal-screencast.token (from first accept) if present.
 *   2. CreateSession + SelectSources + Start (GNOME silently reuses the
 *      prior grant when restore_token is valid).
 *   3. OpenPipeWireRemote → dup2 to fd 3 → gst-launch-1.0 pipewiresrc
 *      fd=3 → PNG file.
 *   4. New restore_token is written back for the next call.
 *
 * Typical timing on this machine: first call ~1–2 s (user click on dialog);
 * subsequent calls ~250 ms end-to-end.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { runPythonJsonHelper } from "./python-json-helper";

const CAPTURE_TIMEOUT_MS = 120_000; // generous: first call waits for user click
const HELPER_PATH = path.resolve(__dirname, "..", "..", "scripts", "screencast-capture.py");

export interface ScreenCastFrame {
  pngPath: string;
  width: number;
  height: number;
}

export class ScreenCastSession {
  private tokenPath: string;

  constructor(userDataDir: string) {
    this.tokenPath = path.join(userDataDir, "portal-screencast.token");
  }

  /**
   * No-op for API compatibility with the earlier dbus-next-based
   * implementation. We don't hold an open session between calls — Python
   * creates and tears down a session per capture, which the restore_token
   * keeps silent.
   */
  async init(): Promise<void> {
    if (!fs.existsSync(HELPER_PATH)) {
      throw new Error(`screencast helper missing at ${HELPER_PATH}`);
    }
  }

  async captureFrame(): Promise<ScreenCastFrame> {
    const pngPath = path.join(
      os.tmpdir(),
      `control-deck-grab-${crypto.randomBytes(6).toString("hex")}.png`,
    );

    const result = await runPythonJsonHelper<HelperResult>(
      HELPER_PATH,
      [pngPath, this.tokenPath],
      { timeoutMs: CAPTURE_TIMEOUT_MS, label: "screencast" },
    );
    if (!result.ok) throw new Error(result.error || "screencast capture failed");
    if (!fs.existsSync(result.path)) {
      throw new Error(`helper reported success but no file at ${result.path}`);
    }
    return { pngPath: result.path, width: result.width, height: result.height };
  }

  async close(): Promise<void> {
    // Nothing persistent to tear down — Python already closed its session.
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
