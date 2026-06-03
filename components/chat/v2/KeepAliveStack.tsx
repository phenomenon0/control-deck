"use client";

/**
 * KeepAliveStack — the shared "keep mounted, never collapse" surface manager.
 *
 * Stacks every item absolutely (inset:0) inside one relative box, showing only
 * the active one. Hidden items use `opacity:0` + `inert` (NOT `display:none` and
 * NOT `visibility:hidden`):
 *   - `display:none` makes a pane 0×0, so wterm's internal ResizeObserver resizes
 *     the terminal buffer to 1×1 and corrupts/erases text.
 *   - `visibility:hidden` is overridable by descendants — xterm/wterm sets
 *     `visibility:visible` on its own elements, so the hidden terminal LEAKS and
 *     paints through the (transparent) active pane.
 *   - `opacity:0` creates a compositing group children cannot override, so the
 *     whole subtree is reliably invisible while staying laid out at full size —
 *     wterm's ResizeObserver always sees correct dimensions, nothing to refit on
 *     show. `inert` keeps the hidden subtree out of focus/tab/pointer order.
 *
 * Items mount lazily on first activation and then stay mounted (stable keys), so
 * live state — chat streams, terminal sockets + scrollback, the comfy iframe —
 * survives navigation without being torn down.
 *
 * Used by both the deck pane switch (ComposedDeckLive) and the terminal window
 * stacking (TerminalChrome).
 */

import { useRef, type ReactNode } from "react";

export interface KeepAliveItem {
  id: string;
  node: ReactNode;
}

export interface KeepAliveStackProps {
  items: KeepAliveItem[];
  activeId: string | null;
  /** Extra classes on the relative container. */
  className?: string;
  /**
   * Data attribute set to "active" on the active item's wrapper (e.g.
   * "data-term-window"), so callers can scope queries (spatial nav, tests) to
   * the visible item without colliding with other data-* attrs.
   */
  activeAttr?: string;
  /**
   * Lazy mount (default): an item mounts on first activation, then stays. Use for
   * heavy surfaces you may never open (the deck pane switch). Set `false` to mount
   * EVERY item immediately — terminal windows must stay live (PTY sockets +
   * scrollback) the moment they exist, even ones restored but not yet clicked.
   */
  lazy?: boolean;
}

export function KeepAliveStack({ items, activeId, className, activeAttr, lazy = true }: KeepAliveStackProps) {
  // An item mounts once it has first been active, then stays mounted (stable key).
  // (activeId changing already re-renders us, so adding during render is safe.)
  const mounted = useRef<Set<string>>(new Set());
  if (activeId) mounted.current.add(activeId);

  return (
    <div className={`relative flex min-h-0 min-w-0 flex-1${className ? ` ${className}` : ""}`}>
      {items.map((item) => {
        if (lazy && !mounted.current.has(item.id)) return null;
        const active = item.id === activeId;
        return (
          <div
            key={item.id}
            data-keepalive-item={item.id}
            aria-hidden={!active}
            inert={!active}
            {...(active && activeAttr ? { [activeAttr]: "active" } : {})}
            className="absolute inset-0 flex min-h-0 min-w-0"
            style={{
              opacity: active ? undefined : 0,
              pointerEvents: active ? undefined : "none",
              zIndex: active ? 1 : 0,
            }}
          >
            {item.node}
          </div>
        );
      })}
    </div>
  );
}

export default KeepAliveStack;
