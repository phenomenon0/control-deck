/**
 * xdg-desktop-portal ScreenCast client — ScreenCast-only session for silent
 * desktop frame capture.
 *
 * Why separate from remote-desktop.ts: GNOME's portal backend rejects
 * SelectSources on COMBINED RemoteDesktop+ScreenCast sessions with
 * "Unknown method SelectSources or interface
 * org.freedesktop.impl.portal.ScreenCast". A dedicated ScreenCast session
 * (no RemoteDesktop devices) works fine.
 *
 * Flow: CreateSession → SelectSources → Start → OpenPipeWireRemote → pull
 * frames via gstreamer `pipewiresrc`. First Start shows one screen-share
 * dialog; the session stays warm in memory for subsequent silent grabs.
 *
 * Spec: https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.ScreenCast.html
 */

import * as dbus from "dbus-next";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { spawn } from "node:child_process";

const BUS = "org.freedesktop.portal.Desktop";
const PATH = "/org/freedesktop/portal/desktop";
const SCREENCAST_IFACE = "org.freedesktop.portal.ScreenCast";
const REQUEST_IFACE = "org.freedesktop.portal.Request";

const SOURCE_TYPE_MONITOR = 1;

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

interface ScreenCastStream {
  nodeId: number;
  position?: { x: number; y: number };
  size?: { width: number; height: number };
}

export class ScreenCastSession {
  private bus: dbus.MessageBus | null = null;
  private iface: dbus.ClientInterface | null = null;
  private sessionHandle: string | null = null;
  private senderName = "";
  private streams: ScreenCastStream[] = [];

  get streamId(): number | null {
    return this.streams[0]?.nodeId ?? null;
  }

  async init(): Promise<void> {
    this.bus = dbus.sessionBus();
    const obj = await this.bus.getProxyObject(BUS, PATH);
    this.iface = obj.getInterface(SCREENCAST_IFACE);
    const busName = (this.bus as unknown as { name?: string }).name ?? "";
    this.senderName = busName.replace(/^:/, "").replace(/\./g, "_");

    const sessionHandle = await this.createSession();
    await this.selectSources(sessionHandle);
    const streams = await this.start(sessionHandle);
    this.sessionHandle = sessionHandle;
    this.streams = streams;
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
    if (!this.iface) throw new Error("not initialised");
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

  private async selectSources(sessionHandle: string): Promise<void> {
    if (!this.iface) throw new Error("not initialised");
    const handleToken = this.handleToken();
    const requestPath = this.requestPath(handleToken);
    const pending = this.awaitResponse(requestPath);

    await this.iface.SelectSources(sessionHandle, {
      handle_token: new dbus.Variant("s", handleToken),
      types: new dbus.Variant("u", SOURCE_TYPE_MONITOR),
      multiple: new dbus.Variant("b", false),
    });
    const res = await pending;
    if (res.code !== 0) throw new Error(`SelectSources failed (code=${res.code})`);
  }

  private async start(sessionHandle: string): Promise<ScreenCastStream[]> {
    if (!this.iface) throw new Error("not initialised");
    const handleToken = this.handleToken();
    const requestPath = this.requestPath(handleToken);
    const pending = this.awaitResponse(requestPath);

    await this.iface.Start(sessionHandle, "", {
      handle_token: new dbus.Variant("s", handleToken),
    });

    const res = await pending;
    if (res.code !== 0) {
      throw new Error(
        res.code === 1 ? "user denied ScreenCast permission" : `Start failed (code=${res.code})`,
      );
    }
    return parseStreams(res.results.streams);
  }

  async openPipeWireRemote(): Promise<number> {
    if (!this.iface || !this.sessionHandle) throw new Error("session not started");
    const result = (await this.iface.OpenPipeWireRemote(this.sessionHandle, {})) as unknown;
    const fd = Number(result);
    if (!Number.isInteger(fd) || fd < 0) {
      throw new Error(`OpenPipeWireRemote returned non-FD: ${result}`);
    }
    return fd;
  }

  async captureFrame(): Promise<{ pngPath: string; width: number; height: number }> {
    const streamId = this.streamId;
    if (streamId === null) throw new Error("no ScreenCast stream");
    const fd = await this.openPipeWireRemote();
    const outPath = path.join(
      os.tmpdir(),
      `control-deck-grab-${crypto.randomBytes(6).toString("hex")}.png`,
    );

    try {
      await new Promise<void>((resolve, reject) => {
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
      try { fs.closeSync(fd); } catch {}
    }

    if (!fs.existsSync(outPath)) throw new Error(`gst-launch produced no file at ${outPath}`);
    const { width, height } = readPngDimensions(outPath);
    return { pngPath: outPath, width, height };
  }

  async close(): Promise<void> {
    if (!this.bus || !this.sessionHandle) return;
    try {
      const sessObj = await this.bus.getProxyObject(BUS, this.sessionHandle);
      const sessIface = sessObj.getInterface("org.freedesktop.portal.Session");
      await sessIface.Close();
    } catch {}
    this.sessionHandle = null;
  }
}

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
