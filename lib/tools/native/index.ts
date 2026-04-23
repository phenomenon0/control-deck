/**
 * Platform router for native-surface adapters.
 *
 * Higher layers should only ever import from this file; it returns the
 * correct adapter for the current host OS, or a clear error on unsupported
 * platforms / missing dependencies.
 */

import type { NativeAdapter } from "./types";

let cached: NativeAdapter | null = null;

export async function getNativeAdapter(): Promise<NativeAdapter> {
  if (cached) return cached;

  if (process.platform === "linux") {
    const { linuxAtspiAdapter } = await import("./linux-atspi");
    cached = linuxAtspiAdapter;
    return cached;
  }

  if (process.platform === "darwin") {
    const { macosAxAdapter } = await import("./macos-ax");
    cached = macosAxAdapter;
    return cached;
  }

  if (process.platform === "win32") {
    const { windowsUiaAdapter } = await import("./windows-uia");
    cached = windowsUiaAdapter;
    return cached;
  }

  cached = unsupportedAdapter("unsupported", `no native adapter for ${process.platform}`);
  return cached;
}

function unsupportedAdapter(
  platform: NativeAdapter["platform"],
  message: string,
): NativeAdapter {
  const fail = async () => {
    throw new Error(message);
  };
  return {
    platform,
    locate: fail,
    click: fail,
    typeText: fail,
    getTree: fail,
    key: fail,
    focus: fail,
    screenGrab: fail,
    focusWindow: fail,
    clickPixel: fail,
    isAvailable: async () => false,
  };
}

export type {
  ClickResult,
  KeyEvent,
  NativeAdapter,
  NodeHandle,
  LocateQuery,
  TreeNode,
  ScreenGrabResult,
  FocusWindowResult,
  PointerButton,
  ClickPixelArgs,
  UiaPattern,
  InvokeArgs,
  InvokeResult,
  WaitForArgs,
  WaitForResult,
  WaitForEvent,
  ElementFromPointArgs,
  ReadTextArgs,
  ReadTextResult,
  WithCacheArgs,
  WithCacheResult,
  WatchAction,
  WatchInstallArgs,
  WatchInstallResult,
  WatchDrainArgs,
  WatchDrainResult,
  WatchEventRecord,
  WatchRemoveArgs,
  WatchRemoveResult,
  BaselineCaptureArgs,
  BaselineCaptureResult,
  BaselineRestoreArgs,
  BaselineRestoreResult,
  BaselineWindow,
} from "./types";
