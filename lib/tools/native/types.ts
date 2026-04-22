/**
 * Shared types for native-surface tool adapters.
 *
 * Windows (UIA), macOS (AX) and Linux (AT-SPI) adapters all implement this
 * interface, so higher layers (bridge, executor, Agent-GO) speak one schema
 * regardless of host OS.
 */

export interface NodeHandle {
  /** Opaque adapter-specific id; round-tripped back to the adapter on click/type. */
  id: string;
  /** Human-readable role (e.g. "button", "menu item"). */
  role?: string;
  /** Accessible name. */
  name?: string;
  /** Path from root, useful for debugging and stable-ish re-location. */
  path?: string;
  /** Bounding rectangle in absolute desktop pixels, when the element is on screen. */
  bounds?: { x: number; y: number; width: number; height: number };
}

export interface LocateQuery {
  /** Accessible name (exact or substring match depending on adapter). */
  name?: string;
  /** Role filter (e.g. "button", "window"). */
  role?: string;
  /** App / process hint (e.g. "Firefox", "Calculator"). */
  app?: string;
  /** Max results — adapters may cap lower. */
  limit?: number;
}

export interface TreeNode {
  handle: NodeHandle;
  children: TreeNode[];
}

export interface ClickResult {
  /** Which strategy in the cascade actually fired. */
  method: "action" | "focus+enter" | "mouse" | "unknown";
}

export interface KeyEvent {
  /**
   * Key identifier. Accepts:
   *  - single characters ("a", "1", " ")
   *  - X11 keysym names ("Return", "Tab", "Escape", "F10", "Left", "Down")
   *  - key combos as "+"-separated ("Ctrl+l", "Alt+F10", "Ctrl+Shift+Tab")
   */
  key: string;
}

export interface ScreenGrabResult {
  /** Base64-encoded PNG bytes of the full desktop. */
  pngBase64: string;
  /** Pixel width of the capture. */
  width: number;
  /** Pixel height of the capture. */
  height: number;
}

export interface FocusWindowResult {
  /** True if the helper dispatched an Activate — not a guarantee of raise. */
  dispatched: boolean;
  /** Diagnostic log from the helper (tokens minted, errors, etc.). */
  log: string;
}

export type PointerButton = "left" | "right" | "middle";

export interface ClickPixelArgs {
  x: number;
  y: number;
  button?: PointerButton;
}

/**
 * UI Automation control patterns — Windows-only surface. Agents address
 * these by name so the adapter can dispatch to the correct IUIAutomation
 * pattern without reflection.
 */
export type UiaPattern =
  | "Invoke"
  | "Toggle"
  | "ExpandCollapse"
  | "Scroll"
  | "ScrollItem"
  | "RangeValue"
  | "Value"
  | "Selection"
  | "SelectionItem"
  | "Window";

export interface InvokeArgs {
  handle: NodeHandle;
  pattern: UiaPattern;
  /** Pattern-specific action name (e.g. "Invoke", "Toggle", "Expand", "SetValue"). */
  action: string;
  /** Serialized params for the action (e.g. { value: 42 } for RangeValue.SetValue). */
  params?: Record<string, unknown>;
}

export interface InvokeResult {
  /** Whether the pattern dispatch succeeded. */
  ok: boolean;
  /** Pattern-specific return payload (e.g. toggle state after Toggle). */
  data?: Record<string, unknown>;
}

export type WaitForEvent =
  | "structure_changed"
  | "focus_changed"
  | "property_changed";

export interface WaitForArgs {
  event: WaitForEvent;
  /** Optional anchor handle — limits subscription to this subtree. */
  handle?: NodeHandle;
  /** Match predicate — substring match on name/role/automationId after the event. */
  match?: {
    name?: string;
    role?: string;
    automationId?: string;
    /** For property_changed events: which property name. */
    property?: string;
  };
  /** Timeout in ms. Default 30_000, capped at 60_000 by the host. */
  timeoutMs?: number;
}

export interface WaitForResult {
  /** True if the event matched before the timeout. */
  matched: boolean;
  /** The element that triggered the event, when applicable. */
  handle?: NodeHandle;
}

export interface ElementFromPointArgs {
  x: number;
  y: number;
}

export interface ReadTextArgs {
  handle: NodeHandle;
  /**
   * Optional range within the element's TextPattern document. Omit for
   * the full text. Currently supports simple offset pairs; richer
   * ranges (by line / paragraph) may be added later.
   */
  range?: { start: number; end: number };
}

export interface ReadTextResult {
  text: string;
  /** Extracted hyperlinks with their display text + URI. */
  hyperlinks?: Array<{ text: string; uri: string }>;
  /** Current selection ranges within the element, if any. */
  selection?: Array<{ start: number; end: number }>;
}

export interface WithCacheArgs {
  /** Anchor for the cached subtree — omit for desktop root. */
  handle?: NodeHandle;
  /**
   * Depth of the cached walk. 1 = handle only, 2 = handle + children, etc.
   * Capped server-side to prevent full-tree prefetch on large apps.
   */
  depth?: number;
  /** Sub-ops to run against the cached subtree in a single round-trip. */
  ops: Array<
    | { op: "locate"; query: LocateQuery }
    | { op: "tree" }
    | { op: "read_text"; handle: NodeHandle }
  >;
}

export interface WithCacheResult {
  /** One result per op, in order, with the same shape the non-cached op returns. */
  results: Array<NodeHandle[] | TreeNode | ReadTextResult>;
}

// -------------------------------------------------------------------
//  Interrupt-handling primitives (Windows-only extras, all optional).
//  See docs/native-adapter/windows.md "Robust automation" for design.
// -------------------------------------------------------------------

export type WatchAction = "notify" | "dismiss_via_escape" | "invoke_button";

export interface WatchInstallArgs {
  match: {
    name?: string;
    role?: string;
    automationId?: string;
    app?: string;
  };
  /** What to do when a matching window/dialog appears. */
  action?: WatchAction;
  /** Required when action === "invoke_button" — button display name. */
  buttonName?: string;
  /** "desktop" watches everywhere; "app" limits to current foreground app subtree. */
  scope?: "desktop" | "app";
  /** TTL in ms, default 300_000 (5 min), hard cap 1_800_000 (30 min). */
  ttlMs?: number;
}

export interface WatchInstallResult {
  watchId: string;
}

export interface WatchEventRecord {
  watchId: string;
  /** Unix ms timestamp. */
  at: number;
  kind: string;
  actionTaken: string;
  error?: string;
  element: NodeHandle;
}

export interface WatchDrainArgs {
  /** Drain a specific watcher, or omit to drain all. */
  watchId?: string;
}

export interface WatchDrainResult {
  events: WatchEventRecord[];
  activeWatchers: number;
}

export interface WatchRemoveArgs {
  watchId: string;
}

export interface WatchRemoveResult {
  removed: boolean;
}

export interface BaselineCaptureArgs {
  label?: string;
}

export interface BaselineWindow {
  title: string;
  pid: number;
  isModal?: boolean;
}

export interface BaselineCaptureResult {
  baselineId: string;
  label?: string;
  capturedAt: number;
  windows: BaselineWindow[];
  modalDepth: number;
}

export interface BaselineRestoreArgs {
  baselineId: string;
  strategy?: "close_modals" | "close_modals_then_focus";
}

export interface BaselineRestoreResult {
  closed: number;
  focused: boolean;
  residual: BaselineWindow[];
}

export interface NativeAdapter {
  /** Platform label, mostly for diagnostics. */
  readonly platform: "linux" | "darwin" | "win32" | "unsupported";

  /** Query the accessibility tree for matching nodes. */
  locate(query: LocateQuery): Promise<NodeHandle[]>;

  /** Click an element previously returned from locate. Returns which method fired. */
  click(handle: NodeHandle): Promise<ClickResult>;

  /** Type text into an element (or the focused one if handle is null). */
  typeText(handle: NodeHandle | null, text: string): Promise<void>;

  /** Dump the accessibility tree rooted at handle (or the active window). */
  getTree(handle?: NodeHandle): Promise<TreeNode>;

  /** Send a key or key combo to the focused widget. */
  key(event: KeyEvent): Promise<void>;

  /** Move focus to an element; returns true if the widget accepted focus. */
  focus(handle: NodeHandle): Promise<boolean>;

  /** Capture the full desktop as a PNG (Wayland-safe via xdg Screenshot portal). */
  screenGrab(): Promise<ScreenGrabResult>;

  /** Raise + focus a running app by desktop app-id (e.g. "org.telegram.desktop"). */
  focusWindow(appId: string): Promise<FocusWindowResult>;

  /** Click at absolute desktop pixel coords via ScreenCast stream (Wayland). */
  clickPixel(args: ClickPixelArgs): Promise<void>;

  /** Optional readiness probe — returns false if the adapter can't work here. */
  isAvailable?(): Promise<boolean>;

  /**
   * Windows-only: dispatch a UIA control pattern directly (Invoke,
   * Toggle, RangeValue.SetValue, etc.) without synthesizing input.
   * Far more reliable than click cascade for non-simple controls.
   */
  invoke?(args: InvokeArgs): Promise<InvokeResult>;

  /**
   * Windows-only: subscribe to a UIA automation event (structure
   * change, focus change, property change) and resolve when a matching
   * event arrives or the timeout elapses.
   */
  waitFor?(args: WaitForArgs): Promise<WaitForResult>;

  /**
   * Windows-only: resolve the element at an absolute desktop pixel.
   * Turns pointer coords into a semantic NodeHandle.
   */
  elementFromPoint?(args: ElementFromPointArgs): Promise<NodeHandle | null>;

  /**
   * Windows-only: read structured text from a UIA TextPattern element,
   * including hyperlinks and current selection. Reads rich text
   * without OCR.
   */
  readText?(args: ReadTextArgs): Promise<ReadTextResult>;

  /**
   * Windows-only: run a batch of ops against a cached subtree in a
   * single round-trip. 10-100x faster than cold tree walks for large
   * surfaces (Explorer, Outlook).
   */
  withCache?(args: WithCacheArgs): Promise<WithCacheResult>;

  /**
   * Windows-only: install a background watcher that fires when a
   * matching window/dialog appears anywhere on the desktop. Core
   * primitive for robust automation against apps that throw
   * unexpected modals.
   */
  watchInstall?(args: WatchInstallArgs): Promise<WatchInstallResult>;

  /**
   * Windows-only: read queued events from one or all active watchers.
   * Agents should drain between every risky action.
   */
  watchDrain?(args: WatchDrainArgs): Promise<WatchDrainResult>;

  /**
   * Windows-only: remove an installed watcher.
   */
  watchRemove?(args: WatchRemoveArgs): Promise<WatchRemoveResult>;

  /**
   * Windows-only: capture a named "known-good state" snapshot. Pair
   * with baselineRestore as an emergency parachute when the agent
   * lands in an unexpected state.
   */
  baselineCapture?(args: BaselineCaptureArgs): Promise<BaselineCaptureResult>;

  /**
   * Windows-only: close windows introduced since the baseline was
   * captured, optionally re-focus the baseline's foreground window.
   * Hung windows are skipped (not force-closed).
   */
  baselineRestore?(args: BaselineRestoreArgs): Promise<BaselineRestoreResult>;
}

export interface NativeAdapterError {
  code:
    | "unsupported_platform"
    | "not_installed"
    | "permission_denied"
    | "not_found"
    | "adapter_failure";
  message: string;
}
