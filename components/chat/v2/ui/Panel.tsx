"use client";

/**
 * Panel (v2 coherence primitive) — the column/side-panel wrapper + its scroll
 * region. Unifies the three close-but-not-equal recipes (ThreadSidebar dropped
 * `min-h-0`; comfy panels omitted the surface bg; settings used `border-l`).
 *
 *   <Panel surface border="right">
 *     <PanelHeader … />
 *     <Panel.Scroll>…</Panel.Scroll>
 *   </Panel>
 *
 * `min-h-0` is baked in so the scroll boundary always works inside a flex parent.
 */

import React, { forwardRef } from "react";

import { cx } from "./cx";

export type PanelBorder = "none" | "left" | "right";

const BORDER: Record<PanelBorder, string> = {
  none: "",
  left: "border-l border-[var(--border-subtle)]",
  right: "border-r border-[var(--border-subtle)]",
};

export interface PanelProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Fill with the secondary surface bg (side panels). */
  surface?: boolean;
  border?: PanelBorder;
}

function PanelRoot(
  { surface = false, border = "none", className, children, ...rest }: PanelProps,
  ref: React.Ref<HTMLDivElement>,
) {
  return (
    <div
      ref={ref}
      className={cx(
        "cd-panel flex h-full min-h-0 flex-col",
        surface && "bg-[var(--bg-secondary)]",
        BORDER[border],
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export interface PanelScrollProps extends React.HTMLAttributes<HTMLDivElement> {}

/** The scrollable body region — `min-h-0 flex-1 overflow-y-auto`. */
function PanelScroll({ className, children, ...rest }: PanelScrollProps) {
  return (
    <div className={cx("cd-panel-scroll min-h-0 flex-1 overflow-y-auto", className)} {...rest}>
      {children}
    </div>
  );
}

export const Panel = Object.assign(forwardRef<HTMLDivElement, PanelProps>(PanelRoot), {
  Scroll: PanelScroll,
});

export default Panel;
