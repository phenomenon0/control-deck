import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("deck", {
  platform: process.platform,
  electronVersion: process.versions.electron,
  chromeVersion: process.versions.chrome,
  // Narrow IPC surface for the renderer to call into main.
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
});
