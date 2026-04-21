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

  /** Optional readiness probe — returns false if the adapter can't work here. */
  isAvailable?(): Promise<boolean>;
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
