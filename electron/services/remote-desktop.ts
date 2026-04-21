/**
 * xdg-desktop-portal RemoteDesktop client — the Wayland-safe path for
 * keyboard + pointer injection.
 *
 * AT-SPI's `generateKeyboardEvent` routes through XTest, which Wayland
 * sandboxes behind Xwayland. Keys only reach Xwayland-hosted clients, and
 * only when the compositor already considers them focused. The portal's
 * RemoteDesktop interface is the sanctioned replacement: the user grants
 * permission once, the compositor then routes injected events exactly like
 * real hardware input.
 *
 * Lifecycle: one session per app launch. We persist the restore_token in
 * `userData/portal-restore.token` so subsequent launches skip the prompt.
 *
 * Spec: https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.RemoteDesktop.html
 */

import * as dbus from "dbus-next";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { spawn } from "node:child_process";

const BUS = "org.freedesktop.portal.Desktop";
const PATH = "/org/freedesktop/portal/desktop";
const REMOTE_IFACE = "org.freedesktop.portal.RemoteDesktop";
const SCREENCAST_IFACE = "org.freedesktop.portal.ScreenCast";
const REQUEST_IFACE = "org.freedesktop.portal.Request";

// ScreenCast source-type flags (bitfield).
const SOURCE_TYPE_MONITOR = 1;
// Linux input event-code button numbers (include/uapi/linux/input-event-codes.h).
const BTN_LEFT = 0x110;
const BTN_RIGHT = 0x111;
const BTN_MIDDLE = 0x112;

export const POINTER_BUTTONS = {
  left: BTN_LEFT,
  right: BTN_RIGHT,
  middle: BTN_MIDDLE,
} as const;
export type PointerButton = keyof typeof POINTER_BUTTONS;

// dbus-next only pre-populates interfaces it can introspect. Request objects
// live at transient paths the daemon rejects introspection for, so we have
// to hand it the XML up-front.
const REQUEST_XML = `<!DOCTYPE node PUBLIC "-//freedesktop//DTD D-BUS Object Introspection 1.0//EN" "http://www.freedesktop.org/standards/dbus/1.0/introspect.dtd">
<node>
  <interface name="org.freedesktop.portal.Request">
    <method name="Close"/>
    <signal name="Response">
      <arg type="u" name="response"/>
      <arg type="a{sv}" name="results"/>
    </signal>
  </interface>
</node>`;

const DEVICE_KEYBOARD = 1;
const DEVICE_POINTER = 2;

const KEY_PRESSED = 1 as const;
const KEY_RELEASED = 0 as const;

type KeyState = typeof KEY_PRESSED | typeof KEY_RELEASED;

interface PortalResponse {
  code: number;
  results: Record<string, dbus.Variant>;
}

interface ScreenCastStream {
  nodeId: number;
  position?: { x: number; y: number };
  size?: { width: number; height: number };
}

interface StartOutcome {
  sessionHandle: string;
  restoreToken?: string;
  devices: number;
  streams?: ScreenCastStream[];
}

export interface RemoteDesktopOptions {
  /**
   * Enable ScreenCast alongside RemoteDesktop so absolute-coord pointer
   * methods (NotifyPointerMotionAbsolute) have a stream_id to target.
   * Shows a screen-share permission dialog on first run — reserve this
   * session for pixel-click use cases.
   */
  includeScreenCast?: boolean;
}

export class RemoteDesktopSession {
  private bus: dbus.MessageBus | null = null;
  private iface: dbus.ClientInterface | null = null;
  private screenCastIface: dbus.ClientInterface | null = null;
  private sessionHandle: string | null = null;
  private restoreTokenPath: string;
  private senderName = "";
  private includeScreenCast: boolean;
  private streams: ScreenCastStream[] = [];

  constructor(userDataDir: string, options: RemoteDesktopOptions = {}) {
    this.includeScreenCast = Boolean(options.includeScreenCast);
    const suffix = this.includeScreenCast ? "portal-restore-screencast.token" : "portal-restore.token";
    this.restoreTokenPath = path.join(userDataDir, suffix);
  }

  get pointerStreamId(): number | null {
    return this.streams[0]?.nodeId ?? null;
  }

  async init(): Promise<StartOutcome> {
    this.bus = dbus.sessionBus();
    const obj = await this.bus.getProxyObject(BUS, PATH);
    this.iface = obj.getInterface(REMOTE_IFACE);
    if (this.includeScreenCast) {
      this.screenCastIface = obj.getInterface(SCREENCAST_IFACE);
    }
    const busName = (this.bus as unknown as { name?: string }).name ?? "";
    this.senderName = busName.replace(/^:/, "").replace(/\./g, "_");

    const sessionHandle = await this.createSession().catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (/code=2/.test(msg)) {
        throw new Error(
          "CreateSession rejected by portal backend. On GNOME this usually means " +
            "xdg-desktop-portal-gnome started with GDK_BACKEND=wayland,x11 and " +
            "fell back to settings-only mode. Fix: " +
            "`systemctl --user set-environment GDK_BACKEND=wayland && " +
            "systemctl --user restart xdg-desktop-portal-gnome.service` " +
            "(or unset GDK_BACKEND entirely).",
        );
      }
      throw err;
    });
    const restoreToken = this.readRestoreToken();
    await this.selectDevices(sessionHandle, restoreToken);
    if (this.includeScreenCast) {
      await this.selectSources(sessionHandle);
    }
    const outcome = await this.start(sessionHandle);
    this.sessionHandle = sessionHandle;
    this.streams = outcome.streams ?? [];

    if (outcome.restoreToken) this.writeRestoreToken(outcome.restoreToken);
    return { sessionHandle, ...outcome };
  }

  private readRestoreToken(): string | undefined {
    try {
      const t = fs.readFileSync(this.restoreTokenPath, "utf8").trim();
      return t || undefined;
    } catch {
      return undefined;
    }
  }

  private writeRestoreToken(token: string): void {
    try {
      fs.mkdirSync(path.dirname(this.restoreTokenPath), { recursive: true });
      fs.writeFileSync(this.restoreTokenPath, token, { mode: 0o600 });
    } catch (err) {
      console.error("[portal] failed to persist restore token:", err);
    }
  }

  private handleToken(): string {
    return `cd_${crypto.randomBytes(8).toString("hex")}`;
  }

  private requestPath(token: string): string {
    return `/org/freedesktop/portal/desktop/request/${this.senderName}/${token}`;
  }

  private awaitResponse(requestPath: string): Promise<PortalResponse> {
    return new Promise(async (resolve, reject) => {
      if (!this.bus) return reject(new Error("bus not ready"));
      const obj = await this.bus.getProxyObject(BUS, requestPath, REQUEST_XML);
      const req = obj.getInterface(REQUEST_IFACE);
      const listener = (code: number, results: Record<string, dbus.Variant>) => {
        req.off("Response", listener);
        resolve({ code, results });
      };
      req.on("Response", listener);
      setTimeout(() => {
        req.off("Response", listener);
        reject(new Error("portal request timed out"));
      }, 120_000);
    });
  }

  private async createSession(): Promise<string> {
    if (!this.iface) throw new Error("portal not initialised");
    const handleToken = this.handleToken();
    const sessionToken = this.handleToken();
    const requestPath = this.requestPath(handleToken);
    const pending = this.awaitResponse(requestPath);

    await this.iface.CreateSession({
      handle_token: new dbus.Variant("s", handleToken),
      session_handle_token: new dbus.Variant("s", sessionToken),
    });

    const res = await pending;
    if (res.code !== 0) throw new Error(`CreateSession failed (code=${res.code})`);
    const sessionHandle = res.results.session_handle?.value as string | undefined;
    if (!sessionHandle) throw new Error("CreateSession returned no session_handle");
    return sessionHandle;
  }

  private async selectDevices(sessionHandle: string, restoreToken?: string): Promise<void> {
    if (!this.iface) throw new Error("portal not initialised");
    const handleToken = this.handleToken();
    const requestPath = this.requestPath(handleToken);
    const pending = this.awaitResponse(requestPath);

    // On GNOME, combined RemoteDesktop+ScreenCast sessions reject ANY
    // persistence ("Remote desktop sessions cannot persist"). Keyboard-only
    // sessions accept mode 2 fine. So: 0 for combined, 2 for keyboard-only.
    // Upside: within a single Electron launch the session stays warm in
    // memory and all calls are silent. Downside: re-prompted on every
    // Electron boot for the pixel session — acceptable tradeoff.
    const options: Record<string, dbus.Variant> = {
      handle_token: new dbus.Variant("s", handleToken),
      types: new dbus.Variant("u", DEVICE_KEYBOARD | DEVICE_POINTER),
      persist_mode: new dbus.Variant("u", this.includeScreenCast ? 0 : 2),
    };
    if (restoreToken) options.restore_token = new dbus.Variant("s", restoreToken);

    await this.iface.SelectDevices(sessionHandle, options);
    const res = await pending;
    if (res.code !== 0) throw new Error(`SelectDevices failed (code=${res.code})`);
  }

  private async selectSources(sessionHandle: string): Promise<void> {
    if (!this.screenCastIface) throw new Error("ScreenCast iface not attached");
    const handleToken = this.handleToken();
    const requestPath = this.requestPath(handleToken);
    const pending = this.awaitResponse(requestPath);

    // Don't pass cursor_mode — the portal advertises AvailableCursorModes
    // which can be 0 on GNOME, and any explicit cursor_mode is rejected as
    // "Unavailable cursor mode N". Defaulting is always safe.
    //
    // persist_mode: GNOME rejects any persistence on combined sessions
    // ("Remote desktop sessions cannot persist"). Use mode 0 to match
    // SelectDevices in the combined path.
    await this.screenCastIface.SelectSources(sessionHandle, {
      handle_token: new dbus.Variant("s", handleToken),
      types: new dbus.Variant("u", SOURCE_TYPE_MONITOR),
      multiple: new dbus.Variant("b", false),
      persist_mode: new dbus.Variant("u", 0),
    });
    const res = await pending;
    if (res.code !== 0) throw new Error(`SelectSources failed (code=${res.code})`);
  }

  private async start(
    sessionHandle: string,
  ): Promise<{ restoreToken?: string; devices: number; streams?: ScreenCastStream[] }> {
    if (!this.iface) throw new Error("portal not initialised");
    const handleToken = this.handleToken();
    const requestPath = this.requestPath(handleToken);
    const pending = this.awaitResponse(requestPath);

    await this.iface.Start(sessionHandle, "", {
      handle_token: new dbus.Variant("s", handleToken),
    });

    const res = await pending;
    if (res.code !== 0) {
      throw new Error(
        res.code === 1
          ? "user denied RemoteDesktop permission"
          : `Start failed (code=${res.code})`,
      );
    }
    const devices = (res.results.devices?.value as number | undefined) ?? 0;
    const restoreToken = res.results.restore_token?.value as string | undefined;
    const streams = parseStreams(res.results.streams);
    return { restoreToken, devices, streams };
  }

  private ensureReady(): dbus.ClientInterface {
    if (!this.iface || !this.sessionHandle) {
      throw new Error("remote-desktop session not started");
    }
    return this.iface;
  }

  async notifyKeyboardKeysym(keysym: number, state: KeyState): Promise<void> {
    const iface = this.ensureReady();
    await iface.NotifyKeyboardKeysym(this.sessionHandle!, {}, keysym, state);
  }

  async tapKeysym(keysym: number): Promise<void> {
    await this.notifyKeyboardKeysym(keysym, KEY_PRESSED);
    await this.notifyKeyboardKeysym(keysym, KEY_RELEASED);
  }

  async sendKeyCombo(modifierKeysyms: number[], primaryKeysym: number): Promise<void> {
    for (const mod of modifierKeysyms) {
      await this.notifyKeyboardKeysym(mod, KEY_PRESSED);
    }
    try {
      await this.tapKeysym(primaryKeysym);
    } finally {
      for (const mod of [...modifierKeysyms].reverse()) {
        await this.notifyKeyboardKeysym(mod, KEY_RELEASED).catch(() => {});
      }
    }
  }

  async typeString(text: string): Promise<void> {
    for (const ch of text) {
      const keysym = charToKeysym(ch);
      if (keysym === null) continue;
      const needsShift = ch >= "A" && ch <= "Z";
      if (needsShift) {
        await this.sendKeyCombo([KEYSYM_SHIFT], keysym);
      } else {
        await this.tapKeysym(keysym);
      }
    }
  }

  async notifyPointerMotionAbsolute(streamId: number, x: number, y: number): Promise<void> {
    const iface = this.ensureReady();
    await iface.NotifyPointerMotionAbsolute(this.sessionHandle!, {}, streamId, x, y);
  }

  async notifyPointerButton(button: number, state: 0 | 1): Promise<void> {
    const iface = this.ensureReady();
    await iface.NotifyPointerButton(this.sessionHandle!, {}, button, state);
  }

  async clickPixel(x: number, y: number, button: PointerButton = "left"): Promise<void> {
    const streamId = this.pointerStreamId;
    if (streamId === null) {
      throw new Error(
        "no ScreenCast stream — session must be created with includeScreenCast:true",
      );
    }
    const btn = POINTER_BUTTONS[button];
    await this.notifyPointerMotionAbsolute(streamId, x, y);
    await this.notifyPointerButton(btn, 1);
    await this.notifyPointerButton(btn, 0);
  }

  /**
   * Open the PipeWire client socket for this session. Returns a native FD —
   * the caller owns it and must close it (or pass it to a child via spawn's
   * stdio array, which dup's and reaps on child exit).
   *
   * Only works after `init()` has created the session with
   * `includeScreenCast:true`.
   */
  async openPipeWireRemote(): Promise<number> {
    if (!this.screenCastIface || !this.sessionHandle) {
      throw new Error(
        "ScreenCast session not active — construct with includeScreenCast:true",
      );
    }
    const result = (await this.screenCastIface.OpenPipeWireRemote(
      this.sessionHandle,
      {},
    )) as unknown;
    // dbus-next surfaces `h` (unix_fd) as a plain number already duplicated
    // into this process. Reject NaN defensively in case the signature changes.
    const fd = Number(result);
    if (!Number.isInteger(fd) || fd < 0) {
      throw new Error(`OpenPipeWireRemote returned non-FD value: ${result}`);
    }
    return fd;
  }

  /**
   * Pull a single PNG frame from the warm ScreenCast stream via gstreamer.
   * Silent after the first `Start` accept — no permission prompt, no Capture
   * button. Writes the PNG to a temp file and returns its path + dimensions.
   *
   * Requires `gst-launch-1.0` with the `pipewiresrc` and `pngenc` plugins on
   * PATH (Fedora: `gstreamer1-plugins-good`, `pipewire-gstreamer`).
   */
  async captureFrame(): Promise<{ pngPath: string; width: number; height: number }> {
    const streamId = this.pointerStreamId;
    if (streamId === null) {
      throw new Error(
        "no ScreenCast stream — session must be created with includeScreenCast:true",
      );
    }
    const fd = await this.openPipeWireRemote();
    const outPath = path.join(
      os.tmpdir(),
      `control-deck-grab-${crypto.randomBytes(6).toString("hex")}.png`,
    );

    try {
      await new Promise<void>((resolve, reject) => {
        // Child sees the pipewire socket at fd=3 (first entry after stdin/out/err).
        const proc = spawn(
          "gst-launch-1.0",
          [
            "-q",
            "pipewiresrc",
            "fd=3",
            `path=${streamId}`,
            "num-buffers=1",
            "!",
            "videoconvert",
            "!",
            "pngenc",
            "snapshot=true",
            "!",
            "filesink",
            `location=${outPath}`,
          ],
          { stdio: ["ignore", "pipe", "pipe", fd] },
        );
        let stderr = "";
        proc.stderr?.on("data", (c: Buffer) => (stderr += c.toString("utf8")));
        const timer = setTimeout(() => {
          proc.kill("SIGKILL");
          reject(new Error("gst-launch capture timed out"));
        }, 5_000);
        proc.on("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
        proc.on("close", (code) => {
          clearTimeout(timer);
          if (code === 0) resolve();
          else reject(new Error(`gst-launch exited ${code}: ${stderr.trim()}`));
        });
      });
    } finally {
      // Child inherited fd=3 via dup and closes on exit; we also close our copy
      // so the PipeWire client reference is dropped promptly.
      try { fs.closeSync(fd); } catch {}
    }

    if (!fs.existsSync(outPath)) {
      throw new Error(`gst-launch produced no file at ${outPath}`);
    }
    const { width, height } = readPngDimensions(outPath);
    return { pngPath: outPath, width, height };
  }

  async close(): Promise<void> {
    if (!this.bus || !this.sessionHandle) return;
    try {
      const sessObj = await this.bus.getProxyObject(BUS, this.sessionHandle);
      const sessIface = sessObj.getInterface("org.freedesktop.portal.Session");
      await sessIface.Close();
    } catch {
      /* best-effort */
    }
    this.sessionHandle = null;
  }
}

const KEYSYM_SHIFT = 0xffe1;

function charToKeysym(ch: string): number | null {
  const code = ch.codePointAt(0);
  if (code === undefined) return null;
  if (code < 0x20 || code === 0x7f) return null;
  if (code <= 0xff) return code;
  return 0x01000000 + code;
}

// PNG IHDR is always the first chunk; width/height are big-endian u32s at
// offsets 16 and 20. Saves a pull of the `sharp` dep for a 2-field read.
function readPngDimensions(pngPath: string): { width: number; height: number } {
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

// The Start response's `streams` field is `a(ua{sv})` — array of
// (uint32 pipewire_node_id, dict of stream properties). The dict may
// carry `position: (ii)` and `size: (ii)` when ScreenCast sources are
// monitors; we capture both for pixel-coord translation.
function parseStreams(variant: dbus.Variant | undefined): ScreenCastStream[] {
  if (!variant) return [];
  const raw = variant.value as unknown;
  if (!Array.isArray(raw)) return [];
  const out: ScreenCastStream[] = [];
  for (const entry of raw as Array<[number, Record<string, dbus.Variant>]>) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const nodeId = Number(entry[0]);
    if (!Number.isFinite(nodeId)) continue;
    const props = entry[1] ?? {};
    const posRaw = props.position?.value as [number, number] | undefined;
    const sizeRaw = props.size?.value as [number, number] | undefined;
    out.push({
      nodeId,
      position: posRaw ? { x: posRaw[0], y: posRaw[1] } : undefined,
      size: sizeRaw ? { width: sizeRaw[0], height: sizeRaw[1] } : undefined,
    });
  }
  return out;
}
