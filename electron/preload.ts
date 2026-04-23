import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

// Allowlist of channels that deck.invoke() is permitted to reach.
// browser:* channels are intentionally excluded — they are already reachable
// via the typed `browser` object below, so exposing a second untyped path
// would be redundant and widens the attack surface unnecessarily.
const ALLOWED_INVOKE_CHANNELS = new Set<string>([
  "portal:key",
  "portal:type",
  "portal:status",
  "portal:screen_grab",
  "portal:focus_window",
  "portal:click_pixel",
  "terminal:config",
]);

interface BrowserState {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
}

const browser = {
  open: (url: string, opts?: { width?: number; height?: number }) =>
    ipcRenderer.invoke("browser:open", { url, opts }),
  navigate: (url: string) => ipcRenderer.invoke("browser:navigate", { url }),
  back: () => ipcRenderer.invoke("browser:back"),
  forward: () => ipcRenderer.invoke("browser:forward"),
  reload: () => ipcRenderer.invoke("browser:reload"),
  stop: () => ipcRenderer.invoke("browser:stop"),
  close: () => ipcRenderer.invoke("browser:close"),
  onState: (cb: (state: BrowserState) => void) => {
    const handler = (_evt: IpcRendererEvent, state: BrowserState) => cb(state);
    ipcRenderer.on("browser:state", handler);
    return () => ipcRenderer.off("browser:state", handler);
  },
};

contextBridge.exposeInMainWorld("deck", {
  platform: process.platform,
  electronVersion: process.versions.electron,
  chromeVersion: process.versions.chrome,
  invoke: (channel: string, ...args: unknown[]) => {
    if (!ALLOWED_INVOKE_CHANNELS.has(channel)) {
      throw new Error(`deck.invoke: channel '${channel}' not allowed`);
    }
    return ipcRenderer.invoke(channel, ...args);
  },
  browser,
});
