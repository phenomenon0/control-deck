export {};

interface BrowserState {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
}

interface BrowserSurface {
  open: (
    url: string,
    opts?: { width?: number; height?: number },
  ) => Promise<{ ok: boolean; windowId?: number; error?: string }>;
  navigate: (url: string) => Promise<{ ok: boolean; error?: string }>;
  back: () => Promise<{ ok: boolean }>;
  forward: () => Promise<{ ok: boolean }>;
  reload: () => Promise<{ ok: boolean }>;
  stop: () => Promise<{ ok: boolean }>;
  close: () => Promise<{ ok: boolean }>;
  onState: (cb: (state: BrowserState) => void) => () => void;
}

declare global {
  interface Window {
    deck?: {
      platform: NodeJS.Platform;
      electronVersion: string;
      chromeVersion: string;
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
      browser: BrowserSurface;
    };
  }
}
