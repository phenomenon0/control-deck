/**
 * Workspace — types for the two-channel pane bus.
 *
 * Channel 1: `call` (pull, addressable, request/response)
 *   One pane invokes another's capability. No flooding possible —
 *   initiator controls cadence.
 *
 * Channel 2: `subscribe` (push, ambient, rate-contracted)
 *   A pane publishes events on named topics. Subscribers MUST provide a
 *   rate mode (throttle / debounce / coalesce / latest-only). The bus
 *   enforces the contract. Producers declare an expected rate ceiling;
 *   sustained violations auto-throttle.
 */

/** Unique identifier for a pane instance, e.g. "chat:abc123". */
export type PaneId = string;

export interface PaneHandle {
  /** Addressable id — `<type>:<instanceId>`. */
  id: PaneId;
  /** Pane type key, e.g. "chat", "terminal", "canvas". */
  type: string;
  /** Human-readable label for inspectors. */
  label?: string;
}

// ── call channel ────────────────────────────────────────────────────

export type CapabilityHandler<TArgs = unknown, TResult = unknown> =
  (args: TArgs) => TResult | Promise<TResult>;

export interface CapabilitySpec<TArgs = unknown, TResult = unknown> {
  /** Short description for the bus inspector. */
  description?: string;
  /** The actual implementation. */
  handler: CapabilityHandler<TArgs, TResult>;
}

// ── subscribe channel ───────────────────────────────────────────────

/**
 * Rate mode for subscribers. Every subscription MUST pick one — there
 * is no uncapped "fire as often as published" option.
 *
 *  - `throttle` — at most one event per `ms`, drops intermediate events
 *  - `debounce` — fires after `ms` of quiet (one trailing event)
 *  - `coalesce` — buffers events, flushes a merged array every `ms`
 *  - `latest-only` — consumer always receives the most recent; older
 *    events are dropped as new ones arrive. Fires immediately, then
 *    re-fires at most every `ms` with the latest.
 */
export type RateMode = "throttle" | "debounce" | "coalesce" | "latest-only";

export interface SubscribeOptions {
  mode: RateMode;
  /** Window in milliseconds. Must be >= 16 (one animation frame). */
  ms: number;
  /**
   * `coalesce` mode only — cap on buffered events. If exceeded, oldest
   * are dropped. Default: 64.
   */
  maxBacklog?: number;
}

/**
 * Producer-declared expectations for a topic. The bus tracks actual
 * rate vs this ceiling and auto-throttles on sustained violation.
 */
export interface TopicSpec {
  /** Expected average publish rate in events/sec. */
  expectedRatePerSec: number;
  /** Priority hint for the inspector; no scheduling effect today. */
  priority?: "low" | "normal" | "high";
  /** One-line description for the inspector. */
  description?: string;
}

// ── pane registration ───────────────────────────────────────────────

export interface RegisterPaneArgs {
  handle: PaneHandle;
  capabilities?: Record<string, CapabilitySpec>;
  topics?: Record<string, TopicSpec>;
  /** Called after the pane has unregistered, for local cleanup. */
  onUnmount?: () => void;
}

/** Snapshot returned by `listPanes()` for the inspector / agent surface. */
export interface PaneSnapshot {
  handle: PaneHandle;
  capabilities: Array<{ name: string; description?: string }>;
  topics: Array<{ name: string; expectedRatePerSec: number; actualRatePerSec: number; priority?: string }>;
  autoThrottled: string[];
}

// ── errors ──────────────────────────────────────────────────────────

export class PaneNotFoundError extends Error {
  constructor(paneId: PaneId) {
    super(`pane not found: ${paneId}`);
    this.name = "PaneNotFoundError";
  }
}

export class CapabilityNotFoundError extends Error {
  constructor(paneId: PaneId, capability: string) {
    super(`capability not found: ${paneId}.${capability}`);
    this.name = "CapabilityNotFoundError";
  }
}

export class InvalidRateModeError extends Error {
  constructor(mode: string) {
    super(`invalid rate mode: ${mode}`);
    this.name = "InvalidRateModeError";
  }
}

// ── layout tree (used by WorkspaceShell serialization) ─────────────

export type LayoutNode =
  | { kind: "split"; direction: "horizontal" | "vertical"; children: LayoutNode[]; sizes?: number[] }
  | { kind: "tabs"; activeIdx: number; panes: PaneId[] }
  | { kind: "leaf"; paneId: PaneId };

export interface Workspace {
  id: string;
  name: string;
  /** When created / last modified — ISO strings. */
  createdAt: string;
  updatedAt: string;
  /** Opaque Dockview-serialized layout. Kept as-is for round-trip fidelity. */
  layout: unknown;
}
