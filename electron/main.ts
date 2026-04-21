import { app, BrowserWindow, ipcMain, shell, Menu, dialog } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import * as path from "node:path";
import * as http from "node:http";
import * as net from "node:net";
import * as fs from "node:fs";
import { RemoteDesktopSession } from "./services/remote-desktop";

const IS_DEV = !app.isPackaged;
const DEFAULT_ROUTE = process.env.CONTROL_DECK_ROUTE ?? "/deck/chat";

// Wayland: let Chromium pick the native platform instead of forcing X11.
// Must be set before app.whenReady(). Harmless on X11-only systems.
if (process.platform === "linux") {
  app.commandLine.appendSwitch("ozone-platform-hint", "auto");
  app.commandLine.appendSwitch("enable-features", "WaylandWindowDecorations");
}

let serverProc: ChildProcess | null = null;
let serverUrl: string | null = null;
let portalSession: RemoteDesktopSession | null = null;
let portalInitPromise: Promise<RemoteDesktopSession> | null = null;
let portalBridgePort: number | null = null;
let portalBridgeSecret: string | null = null;

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
    if (target.startsWith("http")) {
      shell.openExternal(target);
      return { action: "deny" };
    }
    return { action: "allow" };
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
        };
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

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
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
});
