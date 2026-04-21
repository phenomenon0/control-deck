/**
 * xdg-desktop-portal Screenshot client — one-shot full-desktop PNG capture.
 *
 * Used over ScreenCast for stateless grabs: Screenshot.Screenshot() is a
 * single Request round-trip (~50–200 ms), no PipeWire client required.
 * Reserve ScreenCast for the lazy warm session that absolute-coord pointer
 * injection needs.
 *
 * Spec: https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.Screenshot.html
 */

import * as dbus from "dbus-next";
import * as fs from "node:fs";
import * as crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const BUS = "org.freedesktop.portal.Desktop";
const PATH = "/org/freedesktop/portal/desktop";
const SCREENSHOT_IFACE = "org.freedesktop.portal.Screenshot";
const REQUEST_IFACE = "org.freedesktop.portal.Request";

// dbus-next can't introspect transient Request paths — hand it the XML.
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

interface PortalResponse {
  code: number;
  results: Record<string, dbus.Variant>;
}

export interface ScreenshotResult {
  pngPath: string;
  width: number;
  height: number;
}

export class ScreenshotPortal {
  private bus: dbus.MessageBus | null = null;
  private iface: dbus.ClientInterface | null = null;
  private senderName = "";

  async init(): Promise<void> {
    if (this.iface) return;
    this.bus = dbus.sessionBus();
    const obj = await this.bus.getProxyObject(BUS, PATH);
    this.iface = obj.getInterface(SCREENSHOT_IFACE);
    const busName = (this.bus as unknown as { name?: string }).name ?? "";
    this.senderName = busName.replace(/^:/, "").replace(/\./g, "_");
  }

  async captureOne(): Promise<ScreenshotResult> {
    if (!this.iface || !this.bus) await this.init();
    if (!this.iface || !this.bus) throw new Error("screenshot portal init failed");

    const handleToken = `cd_${crypto.randomBytes(8).toString("hex")}`;
    const requestPath = `/org/freedesktop/portal/desktop/request/${this.senderName}/${handleToken}`;
    const pending = this.awaitResponse(requestPath);

    // interactive:true shows the portal's built-in confirm UI on first run,
    // and silently returns after the user has accepted once. interactive:false
    // with an empty parent_window gets auto-cancelled by the GNOME portal
    // ("Failed to associate portal window with parent window") for
    // non-sandboxed apps like our Electron shell.
    await this.iface.Screenshot("", {
      handle_token: new dbus.Variant("s", handleToken),
      modal: new dbus.Variant("b", false),
      interactive: new dbus.Variant("b", true),
    });

    const res = await pending;
    if (res.code !== 0) {
      throw new Error(
        res.code === 1
          ? "user cancelled screenshot"
          : `Screenshot failed (code=${res.code})`,
      );
    }
    const uri = res.results.uri?.value as string | undefined;
    if (!uri) throw new Error("Screenshot response missing uri");

    const pngPath = uri.startsWith("file://") ? fileURLToPath(uri) : uri;
    if (!fs.existsSync(pngPath)) {
      throw new Error(`Screenshot uri does not exist on disk: ${pngPath}`);
    }
    const { width, height } = readPngDimensions(pngPath);
    return { pngPath, width, height };
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
        reject(new Error("screenshot portal request timed out"));
      }, 30_000);
    });
  }
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
