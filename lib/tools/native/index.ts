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

  // macOS and Windows adapters are stubbed — the full build lands in Phase D.2.
  if (process.platform === "darwin") {
    cached = unsupportedAdapter(
      "darwin",
      "macOS AX adapter not yet implemented; ship as part of the macOS build",
    );
    return cached;
  }

  if (process.platform === "win32") {
    cached = unsupportedAdapter(
      "win32",
      "Windows UIA adapter not yet implemented; FlaUI shim lands with the Windows build",
    );
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
} from "./types";
