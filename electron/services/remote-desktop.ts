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
import * as path from "node:path";
import * as crypto from "node:crypto";

const BUS = "org.freedesktop.portal.Desktop";
const PATH = "/org/freedesktop/portal/desktop";
const REMOTE_IFACE = "org.freedesktop.portal.RemoteDesktop";
const REQUEST_IFACE = "org.freedesktop.portal.Request";

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

interface StartOutcome {
  sessionHandle: string;
  restoreToken?: string;
  devices: number;
}

export class RemoteDesktopSession {
  private bus: dbus.MessageBus | null = null;
  private iface: dbus.ClientInterface | null = null;
  private sessionHandle: string | null = null;
  private restoreTokenPath: string;
  private senderName = "";

  constructor(userDataDir: string) {
    this.restoreTokenPath = path.join(userDataDir, "portal-restore.token");
  }

  async init(): Promise<StartOutcome> {
    this.bus = dbus.sessionBus();
    const obj = await this.bus.getProxyObject(BUS, PATH);
    this.iface = obj.getInterface(REMOTE_IFACE);
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
    const outcome = await this.start(sessionHandle);
    this.sessionHandle = sessionHandle;

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

    const options: Record<string, dbus.Variant> = {
      handle_token: new dbus.Variant("s", handleToken),
      types: new dbus.Variant("u", DEVICE_KEYBOARD | DEVICE_POINTER),
      persist_mode: new dbus.Variant("u", 2),
    };
    if (restoreToken) options.restore_token = new dbus.Variant("s", restoreToken);

    await this.iface.SelectDevices(sessionHandle, options);
    const res = await pending;
    if (res.code !== 0) throw new Error(`SelectDevices failed (code=${res.code})`);
  }

  private async start(sessionHandle: string): Promise<{ restoreToken?: string; devices: number }> {
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
    return { restoreToken, devices };
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
