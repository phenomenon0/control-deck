/**
 * Native UI automation tool handlers.
 *
 * Each function delegates to the platform-specific adapter returned by
 * `getNativeAdapter()`. Windows-only methods check for the optional
 * adapter method and return an `unsupported_platform` envelope on
 * Linux/macOS so the agent gets a clear signal rather than a crash.
 *
 * Extracted from `executor.ts` to keep the dispatcher file small and
 * make the platform surface easy to find. The dispatch switch in
 * `executor.ts` is the only caller.
 */

import type {
  NativeLocateArgs,
  NativeClickArgs,
  NativeTypeArgs,
  NativeTreeArgs,
  NativeKeyArgs,
  NativeFocusArgs,
  NativeScreenGrabArgs,
  NativeFocusWindowArgs,
  NativeClickPixelArgs,
  NativeInvokeArgs,
  NativeWaitForArgs,
  NativeElementFromPointArgs,
  NativeReadTextArgs,
  NativeWithCacheArgs,
  NativeWatchInstallArgs,
  NativeWatchDrainArgs,
  NativeWatchRemoveArgs,
  NativeBaselineCaptureArgs,
  NativeBaselineRestoreArgs,
  NativeCapabilitiesArgs,
} from "../definitions";
import { getNativeAdapter } from "../native";
import type { ToolExecutionResult } from "../executor";

function unsupported(tool: string, platform: string): ToolExecutionResult {
  return {
    success: false,
    message: `${tool} is Windows-only (current platform: ${platform})`,
    error: "unsupported_platform",
  };
}

export async function executeNativeLocate(args: NativeLocateArgs): Promise<ToolExecutionResult> {
  try {
    const adapter = await getNativeAdapter();
    const results = await adapter.locate(args);
    return {
      success: true,
      message: `Found ${results.length} native node${results.length === 1 ? "" : "s"}`,
      data: { platform: adapter.platform, results },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "native_locate failed";
    return { success: false, message: msg, error: msg };
  }
}

export async function executeNativeClick(args: NativeClickArgs): Promise<ToolExecutionResult> {
  try {
    const adapter = await getNativeAdapter();
    const result = await adapter.click(args.handle);
    const note = result.method === "mouse"
      ? " (Wayland mouse fallback — verify side effect; retry with native_key if unreliable)"
      : "";
    return {
      success: true,
      message: `Native click via ${result.method}${note}`,
      data: { method: result.method, platform: adapter.platform },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "native_click failed";
    return { success: false, message: msg, error: msg };
  }
}

export async function executeNativeType(args: NativeTypeArgs): Promise<ToolExecutionResult> {
  try {
    const adapter = await getNativeAdapter();
    await adapter.typeText(args.handle ?? null, args.text);
    return { success: true, message: `Typed ${args.text.length} chars` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "native_type failed";
    return { success: false, message: msg, error: msg };
  }
}

export async function executeNativeTree(args: NativeTreeArgs): Promise<ToolExecutionResult> {
  try {
    const adapter = await getNativeAdapter();
    const tree = await adapter.getTree(args.handle);
    return {
      success: true,
      message: "Native tree dumped",
      data: { platform: adapter.platform, tree },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "native_tree failed";
    return { success: false, message: msg, error: msg };
  }
}

export async function executeNativeKey(args: NativeKeyArgs): Promise<ToolExecutionResult> {
  try {
    const adapter = await getNativeAdapter();
    await adapter.key({ key: args.key });
    return { success: true, message: `Sent key: ${args.key}`, data: { key: args.key } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "native_key failed";
    return { success: false, message: msg, error: msg };
  }
}

export async function executeNativeFocus(args: NativeFocusArgs): Promise<ToolExecutionResult> {
  try {
    const adapter = await getNativeAdapter();
    const focused = await adapter.focus(args.handle);
    return {
      success: true,
      message: focused ? "Focus granted" : "Focus returned false (widget may not be focusable)",
      data: { focused },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "native_focus failed";
    return { success: false, message: msg, error: msg };
  }
}

export async function executeNativeScreenGrab(
  _args: NativeScreenGrabArgs,
): Promise<ToolExecutionResult> {
  try {
    const adapter = await getNativeAdapter();
    const shot = await adapter.screenGrab();
    return {
      success: true,
      message: `Captured desktop ${shot.width}x${shot.height} (${Math.round(shot.pngBase64.length * 3 / 4 / 1024)} KB)`,
      data: {
        platform: adapter.platform,
        png_base64: shot.pngBase64,
        width: shot.width,
        height: shot.height,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "native_screen_grab failed";
    return { success: false, message: msg, error: msg };
  }
}

export async function executeNativeFocusWindow(
  args: NativeFocusWindowArgs,
): Promise<ToolExecutionResult> {
  try {
    const adapter = await getNativeAdapter();
    const result = await adapter.focusWindow(args.app_id);
    return {
      success: true,
      message: result.dispatched
        ? `Activation token dispatched to ${args.app_id}`
        : `Focus-raise completed but helper reported no dispatch for ${args.app_id}`,
      data: {
        platform: adapter.platform,
        app_id: args.app_id,
        dispatched: result.dispatched,
        log: result.log,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "native_focus_window failed";
    return { success: false, message: msg, error: msg };
  }
}

export async function executeNativeClickPixel(
  args: NativeClickPixelArgs,
): Promise<ToolExecutionResult> {
  try {
    const adapter = await getNativeAdapter();
    await adapter.clickPixel({ x: args.x, y: args.y, button: args.button });
    return {
      success: true,
      message: `Clicked ${args.button ?? "left"} at (${args.x}, ${args.y})`,
      data: { x: args.x, y: args.y, button: args.button ?? "left" },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "native_click_pixel failed";
    return { success: false, message: msg, error: msg };
  }
}

export async function executeNativeInvoke(args: NativeInvokeArgs): Promise<ToolExecutionResult> {
  try {
    const adapter = await getNativeAdapter();
    if (!adapter.invoke) return unsupported("native_invoke", adapter.platform);
    const result = await adapter.invoke({
      handle: args.handle,
      pattern: args.pattern,
      action: args.action,
      params: args.params,
    });
    return {
      success: result.ok,
      message: result.ok ? `Invoked ${args.pattern}.${args.action}` : `Invoke failed`,
      data: { platform: adapter.platform, ...result },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "native_invoke failed";
    return { success: false, message: msg, error: msg };
  }
}

export async function executeNativeWaitFor(args: NativeWaitForArgs): Promise<ToolExecutionResult> {
  try {
    const adapter = await getNativeAdapter();
    if (!adapter.waitFor) return unsupported("native_wait_for", adapter.platform);
    const result = await adapter.waitFor({
      event: args.event,
      handle: args.handle,
      match: args.match,
      timeoutMs: args.timeoutMs,
    });
    return {
      success: true,
      message: result.matched ? `Event matched: ${args.event}` : `Timed out waiting for ${args.event}`,
      data: { platform: adapter.platform, ...result },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "native_wait_for failed";
    return { success: false, message: msg, error: msg };
  }
}

export async function executeNativeElementFromPoint(
  args: NativeElementFromPointArgs,
): Promise<ToolExecutionResult> {
  try {
    const adapter = await getNativeAdapter();
    if (!adapter.elementFromPoint) return unsupported("native_element_from_point", adapter.platform);
    const handle = await adapter.elementFromPoint({ x: args.x, y: args.y });
    return {
      success: true,
      message: handle
        ? `Element at (${args.x}, ${args.y}): ${handle.role ?? "?"}/${handle.name ?? "?"}`
        : `No element at (${args.x}, ${args.y})`,
      data: { platform: adapter.platform, handle },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "native_element_from_point failed";
    return { success: false, message: msg, error: msg };
  }
}

export async function executeNativeReadText(args: NativeReadTextArgs): Promise<ToolExecutionResult> {
  try {
    const adapter = await getNativeAdapter();
    if (!adapter.readText) return unsupported("native_read_text", adapter.platform);
    const result = await adapter.readText({ handle: args.handle, range: args.range });
    return {
      success: true,
      message: `Read ${result.text.length} chars`,
      data: { platform: adapter.platform, ...result },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "native_read_text failed";
    return { success: false, message: msg, error: msg };
  }
}

export async function executeNativeWithCache(args: NativeWithCacheArgs): Promise<ToolExecutionResult> {
  try {
    const adapter = await getNativeAdapter();
    if (!adapter.withCache) return unsupported("native_with_cache", adapter.platform);
    const result = await adapter.withCache({
      handle: args.handle,
      depth: args.depth,
      ops: args.ops,
    });
    return {
      success: true,
      message: `Cache-ran ${args.ops.length} op${args.ops.length === 1 ? "" : "s"}`,
      data: { platform: adapter.platform, ...result },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "native_with_cache failed";
    return { success: false, message: msg, error: msg };
  }
}

export async function executeNativeWatchInstall(
  args: NativeWatchInstallArgs,
): Promise<ToolExecutionResult> {
  try {
    const adapter = await getNativeAdapter();
    if (!adapter.watchInstall) return unsupported("native_watch_install", adapter.platform);
    const result = await adapter.watchInstall(args);
    return {
      success: true,
      message: `Watcher installed: ${result.watchId}`,
      data: { platform: adapter.platform, ...result },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "native_watch_install failed";
    return { success: false, message: msg, error: msg };
  }
}

export async function executeNativeWatchDrain(
  args: NativeWatchDrainArgs,
): Promise<ToolExecutionResult> {
  try {
    const adapter = await getNativeAdapter();
    if (!adapter.watchDrain) return unsupported("native_watch_drain", adapter.platform);
    const result = await adapter.watchDrain(args);
    return {
      success: true,
      message: `Drained ${result.events.length} event${result.events.length === 1 ? "" : "s"} (${result.activeWatchers} active watcher${result.activeWatchers === 1 ? "" : "s"})`,
      data: { platform: adapter.platform, ...result },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "native_watch_drain failed";
    return { success: false, message: msg, error: msg };
  }
}

export async function executeNativeWatchRemove(
  args: NativeWatchRemoveArgs,
): Promise<ToolExecutionResult> {
  try {
    const adapter = await getNativeAdapter();
    if (!adapter.watchRemove) return unsupported("native_watch_remove", adapter.platform);
    const result = await adapter.watchRemove(args);
    return {
      success: true,
      message: result.removed ? `Watcher ${args.watchId} removed` : `Watcher ${args.watchId} not found`,
      data: { platform: adapter.platform, ...result },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "native_watch_remove failed";
    return { success: false, message: msg, error: msg };
  }
}

export async function executeNativeBaselineCapture(
  args: NativeBaselineCaptureArgs,
): Promise<ToolExecutionResult> {
  try {
    const adapter = await getNativeAdapter();
    if (!adapter.baselineCapture) return unsupported("native_baseline_capture", adapter.platform);
    const result = await adapter.baselineCapture(args);
    return {
      success: true,
      message: `Baseline ${result.baselineId} captured (${result.windows.length} windows, modalDepth=${result.modalDepth})`,
      data: { platform: adapter.platform, ...result },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "native_baseline_capture failed";
    return { success: false, message: msg, error: msg };
  }
}

export async function executeNativeBaselineRestore(
  args: NativeBaselineRestoreArgs,
): Promise<ToolExecutionResult> {
  try {
    const adapter = await getNativeAdapter();
    if (!adapter.baselineRestore) return unsupported("native_baseline_restore", adapter.platform);
    const result = await adapter.baselineRestore(args);
    return {
      success: true,
      message: `Baseline restored: closed ${result.closed}, focused=${result.focused}, ${result.residual.length} residual`,
      data: { platform: adapter.platform, ...result },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "native_baseline_restore failed";
    return { success: false, message: msg, error: msg };
  }
}

const CORE_NATIVE_TOOLS = [
  "native_locate",
  "native_click",
  "native_type",
  "native_tree",
  "native_key",
  "native_focus",
  "native_screen_grab",
  "native_focus_window",
  "native_click_pixel",
] as const;

const WINDOWS_ONLY_NATIVE_TOOLS = [
  "native_invoke",
  "native_wait_for",
  "native_element_from_point",
  "native_read_text",
  "native_with_cache",
  "native_watch_install",
  "native_watch_drain",
  "native_watch_remove",
  "native_baseline_capture",
  "native_baseline_restore",
] as const;

interface ToolStatus {
  available: boolean;
  reason?: string;
}

function detectLinuxSession(): "wayland" | "x11" | "unknown" {
  if (process.platform !== "linux") return "unknown";
  if ((process.env.XDG_SESSION_TYPE ?? "").toLowerCase() === "wayland") return "wayland";
  if (process.env.WAYLAND_DISPLAY) return "wayland";
  if (process.env.DISPLAY) return "x11";
  return "unknown";
}

type PortalStatus = "reachable" | "announced_unreachable" | "absent";

interface PortalProbe {
  status: PortalStatus;
  url?: string;
  error?: string;
}

async function probePortal(): Promise<PortalProbe> {
  const fs = require("node:fs") as typeof import("node:fs");
  let url = process.env.CONTROL_DECK_PORTAL_URL || "";
  let secret = process.env.CONTROL_DECK_PORTAL_SECRET || "";
  if (!url) {
    if (typeof process.getuid !== "function") return { status: "absent" };
    const handoff = `/tmp/control-deck-portal-${process.getuid()}.json`;
    if (!fs.existsSync(handoff)) return { status: "absent" };
    try {
      const raw = JSON.parse(fs.readFileSync(handoff, "utf8")) as {
        url?: string;
        secret?: string;
        pid?: number;
      };
      if (typeof raw.pid === "number") {
        try {
          process.kill(raw.pid, 0); // throws if dead/foreign
        } catch {
          return { status: "announced_unreachable", url: raw.url, error: "handoff pid is not alive" };
        }
      }
      if (raw.url) url = raw.url;
      if (raw.secret) secret = raw.secret;
    } catch (err) {
      return { status: "announced_unreachable", error: err instanceof Error ? err.message : String(err) };
    }
  }
  if (!url) return { status: "absent" };

  // Real round-trip with the auth secret. /focus_window with empty app_id
  // is intentionally invalid; we just want a non-403 response that proves
  // we can reach the bridge AND auth is correct. 400 = reached & authed.
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-deck-portal-auth": secret },
      body: JSON.stringify({ op: "focus_window", app_id: "" }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (res.status === 403) {
      return { status: "announced_unreachable", url, error: "auth rejected" };
    }
    return { status: "reachable", url };
  } catch (err) {
    return {
      status: "announced_unreachable",
      url,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function executeNativeCapabilities(
  _args: NativeCapabilitiesArgs,
): Promise<ToolExecutionResult> {
  const adapter = await getNativeAdapter();
  const platform = adapter.platform;

  const session = platform === "linux" ? detectLinuxSession() : "n-a";
  const portal = platform === "linux" ? await probePortal() : { status: "absent" as const };
  const portalReachable = portal.status === "reachable";

  let helperReady = false;
  let helperError: string | undefined;
  if (adapter.isAvailable) {
    try {
      helperReady = await adapter.isAvailable();
    } catch (err) {
      helperError = err instanceof Error ? err.message : String(err);
    }
  } else {
    helperReady = platform !== "unsupported";
  }

  const tools: Record<string, ToolStatus> = {};
  for (const t of CORE_NATIVE_TOOLS) {
    if (platform === "unsupported") {
      tools[t] = { available: false, reason: `no native adapter for ${process.platform}` };
      continue;
    }
    if (!helperReady) {
      tools[t] = { available: false, reason: helperError ?? "platform helper not ready" };
      continue;
    }
    // Portal-dependent ops on Linux: screen_grab, focus_window, click_pixel,
    // key (Wayland fallback), and click (Wayland fallback). Downgrade when
    // the portal isn't reachable end-to-end (handoff alone isn't enough —
    // the bridge process may be dead or auth wrong).
    const portalReason =
      portal.status === "absent"
        ? "portal not configured (run inside Electron, or set CONTROL_DECK_PORTAL_URL)"
        : `portal announced but unreachable (${portal.error ?? "no response"}); restart Electron host`;
    if (platform === "linux" && !portalReachable && (t === "native_screen_grab" || t === "native_focus_window" || t === "native_click_pixel")) {
      tools[t] = { available: false, reason: portalReason };
      continue;
    }
    if (platform === "linux" && session === "wayland" && t === "native_click" && !portalReachable) {
      tools[t] = { available: false, reason: `Wayland click requires portal click_pixel fallback: ${portalReason}` };
      continue;
    }
    if (platform === "linux" && session === "wayland" && t === "native_key" && !portalReachable) {
      tools[t] = { available: false, reason: `Wayland key needs portal NotifyKeyboardKeysym: ${portalReason}` };
      continue;
    }
    tools[t] = { available: true };
  }
  for (const t of WINDOWS_ONLY_NATIVE_TOOLS) {
    if (platform === "win32") {
      tools[t] = helperReady
        ? { available: true }
        : { available: false, reason: helperError ?? "WinAutomationHost not ready" };
    } else {
      tools[t] = { available: false, reason: `${t} is Windows-only (current platform: ${platform})` };
    }
  }

  return {
    success: true,
    message: `native capabilities: platform=${platform} session=${session} helper=${helperReady ? "ready" : "down"}${platform === "linux" ? ` portal=${portal.status}` : ""}`,
    data: {
      platform,
      session,
      helperReady,
      helperError,
      portal: platform === "linux" ? portal : undefined,
      tools,
    },
  };
}
