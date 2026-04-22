/**
 * Themed browser windows.
 *
 * Each window is a BaseWindow hosting two WebContentsViews: a 40px header
 * that loads the deck's /browser route (nav controls + URL bar) and a page
 * view that loads the target URL. The page view is a first-class CDP target,
 * so browser-harness can list + drive it over --remote-debugging-port.
 *
 * IPC routing uses the header's webContents.id as the key — the header never
 * has to know its own window id.
 */

import {
  BaseWindow,
  WebContentsView,
  ipcMain,
  screen,
  shell,
  type IpcMainInvokeEvent,
} from "electron";

const HEADER_HEIGHT = 40;
const DEFAULT_WIDTH = 920;
const DEFAULT_HEIGHT = 640;
// Distance from the display edge when we anchor to top-right.
const EDGE_MARGIN = 32;
// How far each successive window slides down+left so rapid clicks don't
// stack identically on one pixel.
const CASCADE_STEP = 28;

export interface OpenBrowserOpts {
  width?: number;
  height?: number;
}

interface ThemedWindow {
  base: BaseWindow;
  header: WebContentsView;
  page: WebContentsView;
  id: number;
}

interface BrowserState {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
}

export interface ThemedBrowserRegistry {
  open(targetUrl: string, opts?: OpenBrowserOpts): number;
  count(): number;
}

export function registerThemedBrowser(config: {
  getBaseUrl: () => string | null;
  preload: string;
}): ThemedBrowserRegistry {
  const windows = new Map<number, ThemedWindow>();
  const headerToWindow = new Map<number, number>();
  let nextId = 1;
  // Cascade counter — resets when it drifts off-screen so we wrap cleanly.
  let cascadeOffset = 0;

  function computeAnchoredBounds(
    width: number,
    height: number,
  ): { x: number; y: number; width: number; height: number } {
    const cursor = screen.getCursorScreenPoint();
    const { workArea } = screen.getDisplayNearestPoint(cursor);
    const w = Math.min(width, workArea.width - EDGE_MARGIN * 2);
    const h = Math.min(height, workArea.height - EDGE_MARGIN * 2);

    // Anchor: top-right of the current display, with a margin so the title
    // bar and drag handle stay fully on-screen. Cascade each subsequent
    // window down+left so the user can see all of them at once.
    const anchorX = workArea.x + workArea.width - w - EDGE_MARGIN;
    const anchorY = workArea.y + EDGE_MARGIN;

    let x = anchorX - cascadeOffset;
    let y = anchorY + cascadeOffset;

    const outOfBoundsLeft = x < workArea.x + EDGE_MARGIN;
    const outOfBoundsBottom = y + h > workArea.y + workArea.height - EDGE_MARGIN;
    if (outOfBoundsLeft || outOfBoundsBottom) {
      cascadeOffset = 0;
      x = anchorX;
      y = anchorY;
    }
    cascadeOffset += CASCADE_STEP;

    return { x, y, width: w, height: h };
  }

  function resolveByHeaderSender(senderId: number): ThemedWindow | undefined {
    const wid = headerToWindow.get(senderId);
    if (wid === undefined) return undefined;
    return windows.get(wid);
  }

  function pushState(w: ThemedWindow): void {
    if (w.header.webContents.isDestroyed() || w.page.webContents.isDestroyed()) {
      return;
    }
    const pc = w.page.webContents;
    const state: BrowserState = {
      url: pc.getURL(),
      title: pc.getTitle(),
      canGoBack: pc.navigationHistory.canGoBack(),
      canGoForward: pc.navigationHistory.canGoForward(),
      loading: pc.isLoading(),
    };
    w.header.webContents.send("browser:state", state);
  }

  function layout(w: ThemedWindow): void {
    const bounds = w.base.getContentBounds();
    w.header.setBounds({
      x: 0,
      y: 0,
      width: bounds.width,
      height: HEADER_HEIGHT,
    });
    w.page.setBounds({
      x: 0,
      y: HEADER_HEIGHT,
      width: bounds.width,
      height: Math.max(0, bounds.height - HEADER_HEIGHT),
    });
  }

  function open(targetUrl: string, opts: OpenBrowserOpts = {}): number {
    const baseUrl = config.getBaseUrl();
    if (!baseUrl) {
      throw new Error(
        "themed-browser: base URL not ready yet — call after embedded server is up",
      );
    }

    const id = nextId++;

    const bounds = computeAnchoredBounds(
      opts.width ?? DEFAULT_WIDTH,
      opts.height ?? DEFAULT_HEIGHT,
    );

    const base = new BaseWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      minWidth: 520,
      minHeight: 360,
      backgroundColor: "#0A0A0B",
      autoHideMenuBar: true,
      title: "Control Deck Browser",
    });

    const header = new WebContentsView({
      webPreferences: {
        preload: config.preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    const page = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        webSecurity: true,
      },
    });

    base.contentView.addChildView(header);
    base.contentView.addChildView(page);

    const w: ThemedWindow = { base, header, page, id };
    windows.set(id, w);
    headerToWindow.set(header.webContents.id, id);

    layout(w);
    base.on("resize", () => layout(w));

    const forward = (): void => pushState(w);
    page.webContents.on("did-navigate", forward);
    page.webContents.on("did-navigate-in-page", forward);
    page.webContents.on("page-title-updated", forward);
    page.webContents.on("did-start-loading", forward);
    page.webContents.on("did-stop-loading", forward);
    page.webContents.on("did-finish-load", forward);

    header.webContents.on("did-finish-load", forward);

    page.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith("http://") || url.startsWith("https://")) {
        try {
          open(url);
        } catch {
          shell.openExternal(url);
        }
        return { action: "deny" };
      }
      return { action: "deny" };
    });

    base.on("closed", () => {
      headerToWindow.delete(header.webContents.id);
      windows.delete(id);
    });

    const headerUrl = `${baseUrl}/browser`;
    header.webContents.loadURL(headerUrl).catch((err) => {
      console.error("[themed-browser] header load failed:", err);
    });
    page.webContents.loadURL(targetUrl).catch((err) => {
      console.error("[themed-browser] page load failed:", err);
    });

    return id;
  }

  const bySender = (evt: IpcMainInvokeEvent): ThemedWindow | undefined =>
    resolveByHeaderSender(evt.sender.id);

  ipcMain.handle(
    "browser:open",
    (_evt, payload: { url: string; opts?: OpenBrowserOpts }) => {
      const wid = open(payload.url, payload.opts);
      return { ok: true, windowId: wid };
    },
  );

  ipcMain.handle("browser:navigate", (evt, payload: { url: string }) => {
    const w = bySender(evt);
    if (!w) return { ok: false, error: "unknown window" };
    w.page.webContents.loadURL(payload.url).catch(() => {});
    return { ok: true };
  });

  ipcMain.handle("browser:back", (evt) => {
    const w = bySender(evt);
    if (!w) return { ok: false };
    const h = w.page.webContents.navigationHistory;
    if (h.canGoBack()) h.goBack();
    return { ok: true };
  });

  ipcMain.handle("browser:forward", (evt) => {
    const w = bySender(evt);
    if (!w) return { ok: false };
    const h = w.page.webContents.navigationHistory;
    if (h.canGoForward()) h.goForward();
    return { ok: true };
  });

  ipcMain.handle("browser:reload", (evt) => {
    const w = bySender(evt);
    if (!w) return { ok: false };
    w.page.webContents.reload();
    return { ok: true };
  });

  ipcMain.handle("browser:stop", (evt) => {
    const w = bySender(evt);
    if (!w) return { ok: false };
    w.page.webContents.stop();
    return { ok: true };
  });

  ipcMain.handle("browser:close", (evt) => {
    const w = bySender(evt);
    if (!w) return { ok: false };
    // Defer destruction to the next tick — destroying the header's webContents
    // synchronously kills the in-flight IPC response, so the renderer Promise
    // never resolves. BaseWindow.destroy() doesn't cascade to child
    // WebContentsViews' webContents in Electron 41, so close each one first.
    setImmediate(() => {
      try {
        if (!w.page.webContents.isDestroyed()) w.page.webContents.close();
        if (!w.header.webContents.isDestroyed()) w.header.webContents.close();
        if (!w.base.isDestroyed()) w.base.destroy();
      } catch (err) {
        console.error("[themed-browser] close failed:", err);
      }
    });
    return { ok: true };
  });

  return {
    open,
    count: () => windows.size,
  };
}
