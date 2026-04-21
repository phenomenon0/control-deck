export {};

declare global {
  interface Window {
    deck?: {
      platform: NodeJS.Platform;
      electronVersion: string;
      chromeVersion: string;
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
    };
  }
}
