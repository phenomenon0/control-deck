import { app, BrowserWindow, ipcMain, shell, Menu, dialog } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import * as path from "node:path";
import * as http from "node:http";
import * as net from "node:net";
import * as fs from "node:fs";
import { RemoteDesktopSession } from "./services/remote-desktop";
import { ScreenshotPortal } from "./services/screenshot-portal";
import { ScreenCastSession } from "./services/screencast";
import { focusApp } from "./services/wl-activator";
import {
  registerThemedBrowser,
  type ThemedBrowserRegistry,
} from "./services/themed-browser";

const IS_DEV = !app.isPackaged;
const DEFAULT_ROUTE = process.env.CONTROL_DECK_ROUTE ?? "/deck/chat";

// Wayland: let Chromium pick the native platform instead of forcing X11.
// Must be set before app.whenReady(). Harmless on X11-only systems.
if (process.platform === "linux") {
  app.commandLine.appendSwitch("ozone-platform-hint", "auto");
  app.commandLine.appendSwitch("enable-features", "WaylandWindowDecorations");
}

// Opt-in CDP port so tools like browser-harness can attach. Off by default in
// both dev and packaged builds — set CONTROL_DECK_DEVTOOLS_PORT to enable.
// See README "Browser automation" section for the attach flow.
const DEVTOOLS_PORT_RAW = process.env.CONTROL_DECK_DEVTOOLS_PORT;
if (DEVTOOLS_PORT_RAW) {
  const port = Number(DEVTOOLS_PORT_RAW);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    console.error(
      `[electron] CONTROL_DECK_DEVTOOLS_PORT invalid (${DEVTOOLS_PORT_RAW}) — ignoring`,
    );
  } else {
    app.commandLine.appendSwitch("remote-debugging-port", String(port));
    app.commandLine.appendSwitch("remote-allow-origins", "*");
    console.log(
      `[electron] CDP enabled: http://127.0.0.1:${port}/json/version`,
    );
  }
}

let serverProc: ChildProcess | null = null;
let serverUrl: string | null = null;
let portalSession: RemoteDesktopSession | null = null;
let portalInitPromise: Promise<RemoteDesktopSession> | null = null;
let pixelSession: RemoteDesktopSession | null = null;
let pixelInitPromise: Promise<RemoteDesktopSession> | null = null;
let screenCastSession: ScreenCastSession | null = null;
let screenCastInitPromise: Promise<ScreenCastSession> | null = null;
let screenshotPortal: ScreenshotPortal | null = null;
let portalBridgePort: number | null = null;
let portalBridgeSecret: string | null = null;
let themedBrowser: ThemedBrowserRegistry | null = null;

function getScreenshotPortal(): ScreenshotPortal {
  if (!screenshotPortal) screenshotPortal = new ScreenshotPortal();
  return screenshotPortal;
}

interface CaptureResult {
  pngPath: string;
  width: number;
  height: number;
  source: "screencast" | "portal";
}

// ScreenCast session: silent after the first Start accept. Uses a
// dedicated ScreenCast-only session (not the combined RemoteDesktop+
// ScreenCast pixel session) because GNOME's portal backend rejects
// SelectSources on combined sessions with "Unknown method SelectSources
// or interface org.freedesktop.impl.portal.ScreenCast".
//
// Falls back to the Screenshot portal only when ScreenCast isn't available
// at all (missing `gst-launch-1.0` or `pipewiresrc`) — NOT on user-cancel,
// which must propagate so the caller knows permission was denied.
async function captureScreen(): Promise<CaptureResult> {
  try {
    console.log("[capture] getScreenCastSession()");
    const sess = await getScreenCastSession();
    console.log("[capture] captureFrame()");
    const shot = await sess.captureFrame();
    console.log(`[capture] ok: ${shot.width}x${shot.height} @ ${shot.pngPath}`);
    return { ...shot, source: "screencast" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[capture] screencast path failed:", msg);
    // Recoverable: we can retry via Screenshot portal. Broad match covers
    // missing tooling (gst-launch / python3 / helper script), backend
    // misrouting on portals.conf, and per-op failures. User-denied is NOT
    // recoverable and is allowed to propagate.
    const isRecoverable =
      !/user denied/.test(msg) &&
      /gst-launch|ENOENT|pipewiresrc|CreateSession failed|SelectSources failed|Start failed|Unknown method|helper missing|no JSON|invalid JSON|helper.*timed out|python3/.test(
        msg,
      );
    if (!isRecoverable) throw err;
    // drop the broken session so a later call doesn't reuse it
    screenCastSession = null;
    screenCastInitPromise = null;
    console.warn(
      "[electron] ScreenCast unavailable, falling back to Screenshot portal:",
      msg,
    );
    const portal = getScreenshotPortal();
    const shot = await portal.captureOne();
    return { ...shot, source: "portal" };
  }
}

async function getPortalSession(): Promise<RemoteDesktopSession> {
  if (portalSession) return portalSession;
  if (portalInitPromise) return portalInitPromise;
  portalInitPromise = (async () => {
    const sess = new RemoteDesktopSession(app.getPath("userData"));
    await sess.init();
    portalSession = sess;
    return sess;
  })();
  try {
    return await portalInitPromise;
  } catch (err) {
    portalInitPromise = null;
    throw err;
  }
}

async function getPixelSession(): Promise<RemoteDesktopSession> {
  if (pixelSession) return pixelSession;
  if (pixelInitPromise) return pixelInitPromise;
  pixelInitPromise = (async () => {
    const sess = new RemoteDesktopSession(app.getPath("userData"), {
      includeScreenCast: true,
    });
    await sess.init();
    pixelSession = sess;
    return sess;
  })();
  try {
    return await pixelInitPromise;
  } catch (err) {
    pixelInitPromise = null;
    throw err;
  }
}

async function getScreenCastSession(): Promise<ScreenCastSession> {
  if (screenCastSession) return screenCastSession;
  if (screenCastInitPromise) return screenCastInitPromise;
  screenCastInitPromise = (async () => {
    const sess = new ScreenCastSession(app.getPath("userData"));
    await sess.init();
    screenCastSession = sess;
    return sess;
  })();
  try {
    return await screenCastInitPromise;
  } catch (err) {
    screenCastInitPromise = null;
    throw err;
  }
}

function probeHttp(url: string, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      resolve((res.statusCode ?? 500) < 500);
      res.resume();
    });
    req.on("error", () => resolve(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForUrl(url: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await probeHttp(url)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (typeof addr === "object" && addr) {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        reject(new Error("could not get port"));
      }
    });
  });
}

async function startEmbeddedServer(): Promise<string> {
  if (IS_DEV) {
    // In dev, the developer runs `bun run dev` separately.
    return process.env.CONTROL_DECK_URL ?? "http://localhost:3333";
  }

  const port = await pickFreePort();
  const standaloneDir = path.join(process.resourcesPath, "app", ".next", "standalone");
  const serverEntry = path.join(standaloneDir, "server.js");

  if (!fs.existsSync(serverEntry)) {
    throw new Error(`embedded server entry missing: ${serverEntry}`);
  }

  // ELECTRON_RUN_AS_NODE makes the Electron binary behave like a plain Node
  // runtime, so we can reuse it to host the Next.js standalone server.
  serverProc = spawn(process.execPath, [serverEntry], {
    cwd: standaloneDir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      CONTROL_DECK_USER_DATA: app.getPath("userData"),
      CONTROL_DECK_SCRIPTS_DIR: path.join(process.resourcesPath, "app", "scripts"),
      CONTROL_DECK_PORTAL_URL: portalBridgePort
        ? `http://127.0.0.1:${portalBridgePort}`
        : "",
      CONTROL_DECK_PORTAL_SECRET: portalBridgeSecret ?? "",
    },
    stdio: ["ignore", "inherit", "inherit"],
  });

  let earlyExit: number | null = null;
  serverProc.on("exit", (code) => {
    earlyExit = code ?? -1;
    console.error(`[electron] embedded server exited (code=${code})`);
  });

  const url = `http://127.0.0.1:${port}`;
  try {
    await waitForUrl(url);
  } catch (err) {
    if (earlyExit !== null) {
      throw new Error(`embedded server exited early with code ${earlyExit}`);
    }
    throw err;
  }
  return url;
}

async function createWindow(): Promise<void> {
  const url = serverUrl ?? (await startEmbeddedServer());
  serverUrl = url;

  const preload = path.join(__dirname, "preload.js");

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: "#0b0b0f",
    autoHideMenuBar: true,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  });

  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/i.test(target)) {
      try {
        themedBrowser?.open(target);
      } catch (err) {
        console.error("[electron] themed browser open failed:", err);
        shell.openExternal(target);
      }
    } else if (/^[a-z][a-z0-9+.-]*:/i.test(target) && !/^javascript:/i.test(target)) {
      // mailto:, tel:, slack:, vscode:, etc. — hand off to the OS.
      shell.openExternal(target).catch(() => {});
    }
    return { action: "deny" };
  });

  await win.loadURL(`${url}${DEFAULT_ROUTE}`);
}

async function startPortalBridge(): Promise<void> {
  if (portalBridgePort) return;
  portalBridgeSecret = require("node:crypto").randomBytes(16).toString("hex");

  const server = http.createServer(async (req, res) => {
    const auth = req.headers["x-deck-portal-auth"];
    if (auth !== portalBridgeSecret) {
      res.statusCode = 403;
      res.end(JSON.stringify({ ok: false, error: "forbidden" }));
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", async () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as {
          op?: string;
          modifiers?: number[];
          keysym?: number;
          text?: string;
          app_id?: string;
          x?: number;
          y?: number;
          button?: "left" | "right" | "middle";
        };
        if (
          body.op === "click_pixel" &&
          typeof body.x === "number" &&
          typeof body.y === "number"
        ) {
          const sess = await getPixelSession();
          await sess.clickPixel(body.x, body.y, body.button ?? "left");
          res.end(JSON.stringify({ ok: true, x: body.x, y: body.y }));
          return;
        }
        if (body.op === "focus_window" && typeof body.app_id === "string") {
          const result = await focusApp(body.app_id);
          res.end(JSON.stringify({ ok: true, ...result }));
          return;
        }
        if (body.op === "screen_grab") {
          const shot = await captureScreen();
          const data = fs.readFileSync(shot.pngPath).toString("base64");
          res.end(
            JSON.stringify({
              ok: true,
              png_base64: data,
              width: shot.width,
              height: shot.height,
              path: shot.pngPath,
              source: shot.source,
            }),
          );
          return;
        }
        const sess = await getPortalSession();
        if (body.op === "key" && typeof body.keysym === "number") {
          await sess.sendKeyCombo(body.modifiers ?? [], body.keysym);
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        if (body.op === "type" && typeof body.text === "string") {
          await sess.typeString(body.text);
          res.end(JSON.stringify({ ok: true, len: body.text.length }));
          return;
        }
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: "bad request" }));
      } catch (err) {
        res.statusCode = 500;
        res.end(
          JSON.stringify({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    });
  });

  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (typeof addr === "object" && addr) portalBridgePort = addr.port;
      resolve();
    }),
  );
  server.unref();

  // Publish port + secret to a per-user file so externally-run dev Next
  // servers (bun run dev) can find them. The packaged build propagates
  // these via env in startEmbeddedServer(); this file is the dev-mode path.
  try {
    const handoff = portalHandoffPath();
    if (handoff && portalBridgePort) {
      fs.writeFileSync(
        handoff,
        JSON.stringify({
          url: `http://127.0.0.1:${portalBridgePort}`,
          secret: portalBridgeSecret,
          pid: process.pid,
        }),
        { mode: 0o600 },
      );
    }
  } catch (err) {
    console.error("[electron] failed to write portal handoff:", err);
  }
}

function portalHandoffPath(): string | null {
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (uid === null) return null;
  return `/tmp/control-deck-portal-${uid}.json`;
}

ipcMain.handle(
  "portal:key",
  async (_evt, payload: { modifiers?: number[]; keysym: number }) => {
    const sess = await getPortalSession();
    await sess.sendKeyCombo(payload.modifiers ?? [], payload.keysym);
    return { ok: true };
  },
);

ipcMain.handle("portal:type", async (_evt, payload: { text: string }) => {
  const sess = await getPortalSession();
  await sess.typeString(payload.text);
  return { ok: true, len: payload.text.length };
});

ipcMain.handle("portal:status", async () => ({
  available: process.platform === "linux",
  initialised: portalSession !== null,
}));

ipcMain.handle("portal:screen_grab", async () => {
  const shot = await captureScreen();
  const data = fs.readFileSync(shot.pngPath).toString("base64");
  return {
    ok: true,
    png_base64: data,
    width: shot.width,
    height: shot.height,
    path: shot.pngPath,
    source: shot.source,
  };
});

ipcMain.handle(
  "portal:focus_window",
  async (_evt, payload: { app_id: string }) => {
    const result = await focusApp(payload.app_id);
    return { ok: true, ...result };
  },
);

ipcMain.handle(
  "portal:click_pixel",
  async (
    _evt,
    payload: { x: number; y: number; button?: "left" | "right" | "middle" },
  ) => {
    const sess = await getPixelSession();
    await sess.clickPixel(payload.x, payload.y, payload.button ?? "left");
    return { ok: true, x: payload.x, y: payload.y };
  },
);

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);

  // Surface the themed-browser IPC handlers as soon as the app activates, so
  // callers (renderer, other IPC paths, tests) don't race createWindow().
  if (!themedBrowser) {
    themedBrowser = registerThemedBrowser({
      getBaseUrl: () => serverUrl,
      preload: path.join(__dirname, "preload.js"),
    });
  }

  if (process.platform === "linux") {
    try {
      await startPortalBridge();
    } catch (err) {
      console.error("[electron] portal bridge failed to start:", err);
    }
  }
  try {
    await createWindow();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[electron] failed to start:", msg);
    dialog.showErrorBox(
      "Control Deck failed to start",
      `${msg}\n\nCheck that the embedded Next server built correctly.`,
    );
    app.quit();
    return;
  }

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (serverProc && !serverProc.killed) {
    serverProc.kill("SIGTERM");
  }
  if (portalSession) {
    portalSession.close().catch(() => {});
    portalSession = null;
  }
  if (pixelSession) {
    pixelSession.close().catch(() => {});
    pixelSession = null;
  }
  if (screenCastSession) {
    screenCastSession.close().catch(() => {});
    screenCastSession = null;
  }
  try {
    const handoff = portalHandoffPath();
    if (handoff && fs.existsSync(handoff)) fs.unlinkSync(handoff);
  } catch {}
});
