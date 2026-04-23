import { app, BrowserWindow, ipcMain, session, shell, Menu, dialog } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import * as path from "node:path";
import * as http from "node:http";
import * as net from "node:net";
import * as fs from "node:fs";
import * as crypto from "node:crypto";
import { RemoteDesktopClient } from "./services/remote-desktop-client";
import { ScreenshotPortal } from "./services/screenshot-portal";
import { ScreenCastSession } from "./services/screencast";
import { focusApp } from "./services/wl-activator";
import {
  registerThemedBrowser,
  type ThemedBrowserRegistry,
} from "./services/themed-browser";
import { registerWindowsHost } from "./services/windows-host";
import { startTerminalService } from "./services/terminal-service";

const IS_DEV = !app.isPackaged;
const DEFAULT_ROUTE = process.env.CONTROL_DECK_ROUTE ?? "/deck/chat";

/**
 * DECK_TOKEN gates every /api/* call in middleware.ts. In packaged builds
 * we auto-generate one per launch if the operator hasn't supplied one, so
 * /api/* is never open by default. The renderer attaches it automatically
 * via the webRequest hook in createWindow(); external code (browser-harness,
 * curl) still needs to read the token from env or portal-handoff.
 *
 * Dev mode keeps the existing behavior: if DECK_TOKEN is unset, /api/* is
 * open. That keeps `bun run dev` frictionless for developers poking at
 * routes directly.
 */
if (!IS_DEV && !process.env.DECK_TOKEN) {
  process.env.DECK_TOKEN = crypto.randomBytes(32).toString("hex");
  console.log("[electron] generated ephemeral DECK_TOKEN for this launch");
}
const DECK_TOKEN = process.env.DECK_TOKEN ?? "";

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
    app.commandLine.appendSwitch("remote-allow-origins", "http://127.0.0.1");
    console.log(
      `[electron] CDP enabled: http://127.0.0.1:${port}/json/version`,
    );
  }
}

let serverProc: ChildProcess | null = null;
let serverUrl: string | null = null;
let isQuitting = false;
const SERVER_SUPERVISOR_MAX_RESTARTS = 3;
const SERVER_SUPERVISOR_BACKOFF_MS = 2_000;
let serverRestartCount = 0;
let screenCastSession: ScreenCastSession | null = null;
let screenCastInitPromise: Promise<ScreenCastSession> | null = null;
let screenshotPortal: ScreenshotPortal | null = null;
let portalBridgePort: number | null = null;
let portalBridgeSecret: string | null = null;
let themedBrowser: ThemedBrowserRegistry | null = null;
let remoteDesktopClient: RemoteDesktopClient | null = null;
let terminalService: { kill: () => void } | null = null;

function resolveRemoteDesktopHelper(): string {
  const candidates = [
    process.env.CONTROL_DECK_SCRIPTS_DIR
      ? path.join(process.env.CONTROL_DECK_SCRIPTS_DIR, "remote-desktop.py")
      : null,
    path.join(process.resourcesPath ?? "", "app", "scripts", "remote-desktop.py"),
    path.join(__dirname, "..", "scripts", "remote-desktop.py"),
    path.join(process.cwd(), "scripts", "remote-desktop.py"),
  ].filter((p): p is string => Boolean(p));
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[candidates.length - 1];
}

async function getRemoteDesktopClient(): Promise<RemoteDesktopClient> {
  if (!remoteDesktopClient) {
    remoteDesktopClient = new RemoteDesktopClient({
      userDataDir: app.getPath("userData"),
      helperPath: resolveRemoteDesktopHelper(),
    });
  }
  await remoteDesktopClient.init();
  return remoteDesktopClient;
}

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
    // In dev, the developer runs `bun run dev` separately. Wait for it
    // instead of crashing on race — the Next server is often still
    // compiling when Electron reaches this point.
    const devUrl = process.env.CONTROL_DECK_URL ?? "http://localhost:3333";
    console.log(`[electron] waiting for dev server at ${devUrl} (start with \`bun run dev\`)`);
    try {
      await waitForUrl(devUrl, 120_000);
      console.log(`[electron] dev server responsive at ${devUrl}`);
    } catch {
      throw new Error(
        `dev server at ${devUrl} never came up. Run \`bun run dev\` in another terminal, then relaunch Electron.`,
      );
    }
    return devUrl;
  }

  const standaloneDir = path.join(process.resourcesPath, "app", ".next", "standalone");
  const serverEntry = path.join(standaloneDir, "server.js");

  if (!fs.existsSync(serverEntry)) {
    throw new Error(`embedded server entry missing: ${serverEntry}`);
  }

  // pickFreePort has to release the port before spawn (the Next server has to
  // bind it itself), so there is always a TOCTOU window where another process
  // could grab it. Retry on EADDRINUSE / early-exit with a fresh port.
  const MAX_ATTEMPTS = 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const port = await pickFreePort();
    try {
      return await spawnNextOnPort(port, standaloneDir, serverEntry);
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[electron] embedded server attempt ${attempt}/${MAX_ATTEMPTS} on port ${port} failed: ${msg}`,
      );
      if (serverProc && !serverProc.killed) {
        serverProc.kill("SIGTERM");
      }
      serverProc = null;
    }
  }
  throw new Error(
    `embedded server failed after ${MAX_ATTEMPTS} attempts: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}

async function spawnNextOnPort(
  port: number,
  standaloneDir: string,
  serverEntry: string,
): Promise<string> {
  // ELECTRON_RUN_AS_NODE makes the Electron binary behave like a plain Node
  // runtime, so we can reuse it to host the Next.js standalone server.
  const child = spawn(process.execPath, [serverEntry], {
    cwd: standaloneDir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      CONTROL_DECK_USER_DATA: app.getPath("userData"),
      CONTROL_DECK_SCRIPTS_DIR: path.join(process.resourcesPath, "app", "scripts"),
      CONTROL_DECK_MACOS_HELPER:
        process.platform === "darwin"
          ? path.join(process.resourcesPath, "app", "scripts", "macos-ax-helper.bin")
          : "",
      CONTROL_DECK_PORTAL_URL: portalBridgePort
        ? `http://127.0.0.1:${portalBridgePort}`
        : "",
      CONTROL_DECK_PORTAL_SECRET: portalBridgeSecret ?? "",
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  serverProc = child;

  let earlyExit: number | null = null;
  const startupExitHandler = (code: number | null) => {
    earlyExit = code ?? -1;
    console.error(`[electron] embedded server exited during startup (code=${code})`);
  };
  child.on("exit", startupExitHandler);

  const url = `http://127.0.0.1:${port}`;
  try {
    await waitForUrl(url);
  } catch (err) {
    if (earlyExit !== null) {
      throw new Error(`embedded server exited early with code ${earlyExit}`);
    }
    throw err;
  }

  // Startup succeeded. Swap the startup-only handler for the supervisor,
  // which respawns on crash so a dead Next server doesn't leave the UI
  // with a silent wall of 404s.
  child.removeListener("exit", startupExitHandler);
  child.on("exit", (code, signal) => {
    // Only supervise the current child. If a later respawn replaced this
    // ref, ignore its death — the new child has its own handler.
    if (serverProc !== child) return;
    if (isQuitting || signal === "SIGTERM") return;
    console.error(
      `[electron] embedded server crashed post-startup code=${code} signal=${signal}`,
    );
    void superviseServerRestart();
  });
  return url;
}

async function superviseServerRestart(): Promise<void> {
  if (serverRestartCount >= SERVER_SUPERVISOR_MAX_RESTARTS) {
    console.error(
      `[electron] embedded server supervisor: giving up after ${SERVER_SUPERVISOR_MAX_RESTARTS} restarts`,
    );
    if (!isQuitting) {
      dialog.showErrorBox(
        "Control Deck backend offline",
        `The embedded server crashed ${SERVER_SUPERVISOR_MAX_RESTARTS} times in a row and has been stopped. Check the console output and relaunch the app.`,
      );
      app.quit();
    }
    return;
  }
  serverRestartCount++;
  console.log(
    `[electron] embedded server supervisor: restart ${serverRestartCount}/${SERVER_SUPERVISOR_MAX_RESTARTS} in ${SERVER_SUPERVISOR_BACKOFF_MS}ms`,
  );
  await new Promise((r) => setTimeout(r, SERVER_SUPERVISOR_BACKOFF_MS));
  if (isQuitting) return;
  try {
    const newUrl = await startEmbeddedServer();
    const urlChanged = newUrl !== serverUrl;
    serverUrl = newUrl;
    if (urlChanged) {
      // Port may have changed (TOCTOU retry picked a fresh one). Reload
      // every open BrowserWindow against the new origin so cached fetches
      // don't hammer the dead port.
      for (const w of BrowserWindow.getAllWindows()) {
        try {
          const current = w.webContents.getURL();
          const route = current.replace(/^https?:\/\/[^/]+/i, "");
          await w.loadURL(`${newUrl}${route || DEFAULT_ROUTE}`);
        } catch (err) {
          console.error("[electron] failed to rebind window to new server URL:", err);
        }
      }
    }
    // Successful restart — reset the counter so a later crash gets a fresh budget.
    serverRestartCount = 0;
  } catch (err) {
    console.error(
      `[electron] embedded server supervisor: restart ${serverRestartCount} failed:`,
      err,
    );
    void superviseServerRestart();
  }
}

let deckTokenHookRegistered = false;
function attachDeckTokenToRendererRequests(serverOrigin: string): void {
  if (deckTokenHookRegistered || !DECK_TOKEN) return;
  deckTokenHookRegistered = true;
  // Scope the filter to our embedded server so external URLs loaded in
  // themed-browser windows never leak the token. The onBeforeSendHeaders
  // filter accepts URL patterns — we match the whole server origin + path.
  const filter = { urls: [`${serverOrigin}/api/*`] };
  session.defaultSession.webRequest.onBeforeSendHeaders(filter, (details, cb) => {
    const next = { ...details.requestHeaders, "X-Deck-Token": DECK_TOKEN };
    cb({ requestHeaders: next });
  });
}

async function createWindow(): Promise<void> {
  const url = serverUrl ?? (await startEmbeddedServer());
  serverUrl = url;
  attachDeckTokenToRendererRequests(url);

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
      sandbox: true,
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
  portalBridgeSecret = crypto.randomBytes(16).toString("hex");

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
          const client = await getRemoteDesktopClient();
          await client.clickPixel({ x: body.x, y: body.y, button: body.button ?? "left" });
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
          try { fs.unlinkSync(shot.pngPath); } catch {}
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
        if (body.op === "key" && typeof body.keysym === "number") {
          const client = await getRemoteDesktopClient();
          await client.key({ modifiers: body.modifiers, keysym: body.keysym });
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        if (body.op === "type" && typeof body.text === "string") {
          const client = await getRemoteDesktopClient();
          await client.type(body.text);
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
      // Unlink before write: `before-quit` cleanup doesn't run on SIGKILL,
      // so a stale handoff from a crashed run can survive. Overwriting with
      // O_CREAT|O_TRUNC is fine, but explicit unlink drops the inode so any
      // still-open reader from the previous run sees EOF.
      try { fs.unlinkSync(handoff); } catch { /* ok if missing */ }
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
    const client = await getRemoteDesktopClient();
    await client.key({ modifiers: payload.modifiers, keysym: payload.keysym });
    return { ok: true };
  },
);

ipcMain.handle("portal:type", async (_evt, payload: { text: string }) => {
  const client = await getRemoteDesktopClient();
  await client.type(payload.text);
  return { ok: true, len: payload.text.length };
});

ipcMain.handle("portal:status", async () => {
  const status = remoteDesktopClient
    ? await remoteDesktopClient.status().catch(() => ({
        alive: false,
        keyboardReady: false,
        pointerReady: false,
      }))
    : { alive: false, keyboardReady: false, pointerReady: false };
  return {
    available: process.platform === "linux",
    initialised: status.alive,
    keyboard_ready: status.keyboardReady,
    pointer_ready: status.pointerReady,
    backend: "python-daemon",
  };
});

ipcMain.handle("portal:screen_grab", async () => {
  const shot = await captureScreen();
  const data = fs.readFileSync(shot.pngPath).toString("base64");
  try { fs.unlinkSync(shot.pngPath); } catch {}
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
    const client = await getRemoteDesktopClient();
    await client.clickPixel({ x: payload.x, y: payload.y, button: payload.button ?? "left" });
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

  if (process.platform === "win32") {
    registerWindowsHost();
  }

  try {
    terminalService = startTerminalService();
  } catch (err) {
    console.error("[electron] terminal service auto-spawn failed:", err);
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
  isQuitting = true;
  if (serverProc && !serverProc.killed) {
    serverProc.kill("SIGTERM");
  }
  if (screenCastSession) {
    screenCastSession.close().catch(() => {});
    screenCastSession = null;
  }
  if (remoteDesktopClient) {
    remoteDesktopClient.close().catch(() => {});
    remoteDesktopClient = null;
  }
  if (terminalService) {
    try { terminalService.kill(); } catch { /* ignore */ }
    terminalService = null;
  }
  try {
    const handoff = portalHandoffPath();
    if (handoff && fs.existsSync(handoff)) fs.unlinkSync(handoff);
  } catch {}
});
