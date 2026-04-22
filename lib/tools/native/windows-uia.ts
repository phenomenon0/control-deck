/**
 * Windows UIA adapter — drives the nine `native_*` tools plus five
 * Windows-exclusive extras (invoke, waitFor, elementFromPoint,
 * readText, withCache).
 *
 * Split of responsibilities:
 *  - Accessibility-tree ops (locate/tree/click/type/focus + UIA
 *    patterns + events) go through WinAutomationHost over JSON-RPC.
 *  - Input-injection ops (key, clickPixel) use SendInput via koffi.
 *  - Screen capture uses node-screenshots (DXGI, multi-monitor safe).
 *  - Window focus raises a HWND via AttachThreadInput + SetForegroundWindow.
 */

import {
  clickPixel as inputClickPixel,
  focusWindow as inputFocusWindow,
  screenCapture,
  sendKey,
  typeText as inputTypeText,
} from "./windows-input";
import { getWindowsHostClient } from "./windows-host-client";
import type {
  BaselineCaptureArgs,
  BaselineCaptureResult,
  BaselineRestoreArgs,
  BaselineRestoreResult,
  ClickPixelArgs,
  ClickResult,
  ElementFromPointArgs,
  FocusWindowResult,
  InvokeArgs,
  InvokeResult,
  KeyEvent,
  LocateQuery,
  NativeAdapter,
  NodeHandle,
  ReadTextArgs,
  ReadTextResult,
  ScreenGrabResult,
  TreeNode,
  WaitForArgs,
  WaitForResult,
  WatchDrainArgs,
  WatchDrainResult,
  WatchInstallArgs,
  WatchInstallResult,
  WatchRemoveArgs,
  WatchRemoveResult,
  WithCacheArgs,
  WithCacheResult,
} from "./types";

const host = getWindowsHostClient();

interface HostEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

async function unwrap<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const envelope = await host.call<HostEnvelope<T>>(method, params);
  if (!envelope.ok) {
    throw new Error(envelope.error ?? `${method} failed`);
  }
  return envelope.data as T;
}

export const windowsUiaAdapter: NativeAdapter = {
  platform: "win32",

  async isAvailable() {
    try {
      await host.call<{ ok: boolean }>("ping", {}, { timeoutMs: 2_000 });
      return true;
    } catch {
      return false;
    }
  },

  async locate(query: LocateQuery): Promise<NodeHandle[]> {
    return unwrap<NodeHandle[]>("locate", { query });
  },

  async click(handle: NodeHandle): Promise<ClickResult> {
    const result = await host.call<HostEnvelope<{
      method?: ClickResult["method"] | "mouse-required";
      boundingRect?: { x: number; y: number; width: number; height: number };
    }>>("click", { handle });

    if (!result.ok) throw new Error(result.error ?? "click failed");

    const method = result.data?.method ?? "unknown";
    if (method === "mouse-required" && result.data?.boundingRect) {
      // Host couldn't fire any UIA pattern nor focus-and-enter. Fall
      // back to a real mouse click at the element's center.
      const r = result.data.boundingRect;
      const cx = Math.round(r.x + r.width / 2);
      const cy = Math.round(r.y + r.height / 2);
      await inputClickPixel(cx, cy, "left");
      return { method: "mouse" };
    }

    // Narrow to the ClickResult union.
    if (method === "action" || method === "focus+enter" || method === "mouse") {
      return { method };
    }
    return { method: "unknown" };
  },

  async typeText(handle: NodeHandle | null, text: string): Promise<void> {
    if (handle) {
      const result = await host.call<HostEnvelope<unknown>>("type", { handle, text });
      if (result.ok) return;
      // Fall through to keyboard injection below — handle might not
      // support ValuePattern and host signalled failure.
    }
    // No handle or host failed — inject at whatever has focus.
    await inputTypeText(text);
  },

  async getTree(handle?: NodeHandle): Promise<TreeNode> {
    return unwrap<TreeNode>("tree", handle ? { handle } : {});
  },

  async key(event: KeyEvent): Promise<void> {
    // Key always goes to the focused window — no round-trip to host,
    // just SendInput. Matches Linux/macOS contract semantics.
    await sendKey(event);
  },

  async focus(handle: NodeHandle): Promise<boolean> {
    const result = await host.call<HostEnvelope<{ focused?: boolean }>>("focus", { handle });
    if (!result.ok) return false;
    return Boolean(result.data?.focused);
  },

  async screenGrab(): Promise<ScreenGrabResult> {
    const shot = await screenCapture();
    return { pngBase64: shot.pngBase64, width: shot.width, height: shot.height };
  },

  async focusWindow(appId: string): Promise<FocusWindowResult> {
    return inputFocusWindow(appId);
  },

  async clickPixel(args: ClickPixelArgs): Promise<void> {
    await inputClickPixel(args.x, args.y, args.button ?? "left");
  },

  // ------------------------------------------------------------
  //  Windows-only extras
  // ------------------------------------------------------------

  async invoke(args: InvokeArgs): Promise<InvokeResult> {
    const result = await host.call<HostEnvelope<Record<string, unknown>>>("invoke", {
      handle: args.handle,
      pattern: args.pattern,
      action: args.action,
      params: args.params ?? {},
    });
    return { ok: result.ok, data: result.data };
  },

  async waitFor(args: WaitForArgs): Promise<WaitForResult> {
    const result = await host.call<HostEnvelope<{
      matched?: boolean;
      handle?: NodeHandle | null;
    }>>("wait_for", {
      event: args.event,
      handle: args.handle,
      match: args.match,
      timeoutMs: args.timeoutMs,
    });
    if (!result.ok) throw new Error(result.error ?? "wait_for failed");
    return {
      matched: Boolean(result.data?.matched),
      handle: result.data?.handle ?? undefined,
    };
  },

  async elementFromPoint(args: ElementFromPointArgs): Promise<NodeHandle | null> {
    const result = await host.call<HostEnvelope<NodeHandle | null>>("element_from_point", {
      x: args.x,
      y: args.y,
    });
    if (!result.ok) throw new Error(result.error ?? "element_from_point failed");
    return result.data ?? null;
  },

  async readText(args: ReadTextArgs): Promise<ReadTextResult> {
    return unwrap<ReadTextResult>("read_text", {
      handle: args.handle,
      range: args.range,
    });
  },

  async withCache(args: WithCacheArgs): Promise<WithCacheResult> {
    return unwrap<WithCacheResult>("with_cache", {
      handle: args.handle,
      depth: args.depth,
      ops: args.ops,
    });
  },

  async watchInstall(args: WatchInstallArgs): Promise<WatchInstallResult> {
    return unwrap<WatchInstallResult>("watch_install", {
      match: args.match,
      action: args.action ?? "notify",
      buttonName: args.buttonName,
      scope: args.scope ?? "desktop",
      ttlMs: args.ttlMs,
    });
  },

  async watchDrain(args: WatchDrainArgs): Promise<WatchDrainResult> {
    return unwrap<WatchDrainResult>("watch_drain", { watchId: args.watchId });
  },

  async watchRemove(args: WatchRemoveArgs): Promise<WatchRemoveResult> {
    return unwrap<WatchRemoveResult>("watch_remove", { watchId: args.watchId });
  },

  async baselineCapture(args: BaselineCaptureArgs): Promise<BaselineCaptureResult> {
    return unwrap<BaselineCaptureResult>("baseline_capture", { label: args.label });
  },

  async baselineRestore(args: BaselineRestoreArgs): Promise<BaselineRestoreResult> {
    return unwrap<BaselineRestoreResult>("baseline_restore", {
      baselineId: args.baselineId,
      strategy: args.strategy ?? "close_modals",
    });
  },
};
