"use client";

/**
 * TerminalSplit — renders a SplitNode as panes + draggable dividers.
 *
 * CRITICAL: panes are rendered as a FLAT, stable-keyed list (keyed by pane id)
 * and positioned ABSOLUTELY from geometry computed off the tree — NOT as nested
 * recursive components. This is deliberate: when you split a pane, the tree
 * restructures (a leaf gets wrapped in a new group), and a recursive renderer
 * would swap the component type at that slot and REMOUNT the pane's terminal
 * (tearing down + rebuilding its wterm → blank screen, lost scrollback, a re-fit
 * mismeasure). A flat list keeps every pane's React position stable across any
 * restructure, so the live terminal node is never torn down — it just moves +
 * resizes. Dividers are likewise flat + absolutely positioned.
 *
 * Each pane frame carries `data-pane-id` so the container can do geometry-based
 * ⌘+arrow focus nav (nearestInDirection) by reading the rendered rects.
 */

import React, { useCallback, useRef, useState } from "react";
import type { SplitDir, SplitGroup, SplitLeaf, SplitNode } from "./splitTree";
import { MIN_PANE_FRACTION } from "./splitTree";
import "./terminal.css";

export interface TerminalSplitProps {
  node: SplitNode;
  focusedPaneId: string;
  onFocusPane: (paneId: string) => void;
  onResize: (groupId: string, sizes: number[]) => void;
  renderPane: (leaf: SplitLeaf) => React.ReactNode;
}

/** A pane's rect (fractions 0..1 of the whole split container) + tmux #P index. */
interface PaneBox {
  leaf: SplitLeaf;
  x: number;
  y: number;
  w: number;
  h: number;
  index: number;
}

/** A divider line between two children of a group. */
interface DividerBox {
  group: SplitGroup;
  /** Sizes index of the child BEFORE this divider. */
  index: number;
  dir: SplitDir;
  /** Boundary line position (container fractions). */
  x: number;
  y: number;
  /** Length of the line along the group's cross-axis (fraction). */
  len: number;
  /** The group's span along the DRAG axis, as a fraction of the container. */
  spanFrac: number;
}

/** Walk the tree once, laying out absolute pane + divider boxes. Pure. */
function computeLayout(
  node: SplitNode,
  x: number,
  y: number,
  w: number,
  h: number,
  panes: PaneBox[],
  dividers: DividerBox[],
  order: { n: number },
): void {
  if (node.type === "leaf") {
    panes.push({ leaf: node, x, y, w, h, index: order.n++ });
    return;
  }
  const isRow = node.dir === "row";
  const count = node.children.length;
  let cum = 0;
  node.children.forEach((child, i) => {
    const frac = node.sizes[i] ?? 1 / count;
    const cx = isRow ? x + w * cum : x;
    const cy = isRow ? y : y + h * cum;
    const cw = isRow ? w * frac : w;
    const ch = isRow ? h : h * frac;
    computeLayout(child, cx, cy, cw, ch, panes, dividers, order);
    cum += frac;
    if (i < count - 1) {
      dividers.push({
        group: node,
        index: i,
        dir: node.dir,
        x: isRow ? x + w * cum : x,
        y: isRow ? y : y + h * cum,
        len: isRow ? h : w,
        spanFrac: isRow ? w : h,
      });
    }
  });
}

export function TerminalSplit({ node, focusedPaneId, onFocusPane, onResize, renderPane }: TerminalSplitProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const panes: PaneBox[] = [];
  const dividers: DividerBox[] = [];
  computeLayout(node, 0, 0, 1, 1, panes, dividers, { n: 0 });
  const split = panes.length > 1;

  const handleDrag = useCallback(
    (group: SplitGroup, index: number, deltaGroupFrac: number) => {
      const sizes = [...group.sizes];
      const total = (sizes[index] ?? 0) + (sizes[index + 1] ?? 0);
      let a = (sizes[index] ?? 0) + deltaGroupFrac;
      a = Math.max(MIN_PANE_FRACTION, Math.min(total - MIN_PANE_FRACTION, a));
      sizes[index] = a;
      sizes[index + 1] = total - a;
      onResize(group.id, sizes);
    },
    [onResize],
  );

  return (
    <div ref={containerRef} className="relative h-full w-full min-h-0 min-w-0">
      {panes.map((p) => {
        const focused = p.leaf.id === focusedPaneId;
        return (
          <div
            key={p.leaf.id}
            className="cd-term-pane flex min-h-0 min-w-0 flex-col overflow-hidden"
            style={{ position: "absolute", left: `${p.x * 100}%`, top: `${p.y * 100}%`, width: `${p.w * 100}%`, height: `${p.h * 100}%` }}
            data-pane-id={p.leaf.id}
            data-pane-index={p.index}
            data-focused={focused}
            onPointerDownCapture={() => onFocusPane(p.leaf.id)}
            onFocusCapture={() => onFocusPane(p.leaf.id)}
          >
            {split && (
              <button
                type="button"
                className="cd-term-pane-index"
                data-active={focused}
                aria-label={`Select pane ${p.index}`}
                title={`Select pane ${p.index}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onFocusPane(p.leaf.id);
                }}
              >
                {p.index}
              </button>
            )}
            {renderPane(p.leaf)}
          </div>
        );
      })}

      {dividers.map((d) => (
        <Divider
          key={`${d.group.id}:${d.index}`}
          dir={d.dir}
          containerRef={containerRef}
          spanFrac={d.spanFrac}
          x={d.x}
          y={d.y}
          len={d.len}
          onDrag={(deltaGroupFrac) => handleDrag(d.group, d.index, deltaGroupFrac)}
        />
      ))}
    </div>
  );
}

function Divider({
  dir,
  containerRef,
  spanFrac,
  x,
  y,
  len,
  onDrag,
}: {
  dir: SplitDir;
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Group's span along the drag axis, as a fraction of the container. */
  spanFrac: number;
  x: number;
  y: number;
  len: number;
  onDrag: (deltaGroupFrac: number) => void;
}) {
  const isRow = dir === "row";
  const [dragging, setDragging] = useState(false);
  const last = useRef(0);

  const handleDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    last.current = isRow ? e.clientX : e.clientY;
    setDragging(true);
  }, [isRow]);

  const handleMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      const rect = containerRef.current?.getBoundingClientRect();
      const containerSpan = rect ? (isRow ? rect.width : rect.height) : 0;
      if (containerSpan <= 0 || spanFrac <= 0) return;
      const pos = isRow ? e.clientX : e.clientY;
      const deltaPx = pos - last.current;
      last.current = pos;
      // px → fraction of the whole container → fraction of THIS group's span.
      onDrag(deltaPx / containerSpan / spanFrac);
    },
    [dragging, isRow, containerRef, spanFrac, onDrag],
  );

  const stop = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    setDragging(false);
  }, []);

  // The boundary line sits ON the seam; nudge back by half its 1px so it
  // straddles the gap. Length runs along the group's cross-axis.
  const style: React.CSSProperties = isRow
    ? { position: "absolute", left: `${x * 100}%`, top: `${y * 100}%`, height: `${len * 100}%`, transform: "translateX(-0.5px)" }
    : { position: "absolute", left: `${x * 100}%`, top: `${y * 100}%`, width: `${len * 100}%`, transform: "translateY(-0.5px)" };

  return (
    <div
      className={`cd-term-divider ${isRow ? "cd-term-divider--row" : "cd-term-divider--col"}`}
      data-dragging={dragging}
      role="separator"
      aria-orientation={isRow ? "vertical" : "horizontal"}
      aria-label="Resize panes"
      style={style}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={stop}
      onPointerCancel={stop}
    />
  );
}

export default TerminalSplit;
