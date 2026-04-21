import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

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
  invoke: (channel: string, ...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args),
  browser,
});
