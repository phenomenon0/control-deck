"use client";

/**
 * TerminalSplit — renders a SplitNode as nested flex groups with draggable
 * dividers. Pure/presentational: it knows nothing about sessions or sockets, it
 * just lays panes out, reports focus, and emits resize. Each leaf frame carries
 * `data-pane-id` so the container can do geometry-based ⌘+arrow focus nav
 * (nearestInDirection) by reading the rendered rects — keeping spatial logic out
 * of this layout primitive.
 *
 * Sizing uses flex-grow ratios (flex-basis:0) so children share space by their
 * `sizes` fractions while 1px dividers stay fixed — no overflow math.
 */

import React, { useCallback, useRef, useState } from "react";
import type { SplitDir, SplitGroup, SplitLeaf, SplitNode } from "./splitTree";
import { allLeaves, MIN_PANE_FRACTION } from "./splitTree";
import "./terminal.css";

export interface TerminalSplitProps {
  node: SplitNode;
  focusedPaneId: string;
  onFocusPane: (paneId: string) => void;
  onResize: (groupId: string, sizes: number[]) => void;
  renderPane: (leaf: SplitLeaf) => React.ReactNode;
  /** Injected by TerminalSplit — pane id → tmux #P index, + total pane count. */
  paneOrder?: Map<string, number>;
  paneCount?: number;
}

/** Everything a child needs except which node to render. */
type SplitChildProps = Omit<TerminalSplitProps, "node">;

export function TerminalSplit(props: TerminalSplitProps) {
  // Assign each pane its tmux-style #P index (depth-first order) so panes are
  // first-class + recognizable (display-panes style badge when split).
  const leaves = allLeaves(props.node);
  const paneOrder = new Map(leaves.map((l, i) => [l.id, i] as const));
  return <NodeView {...props} paneOrder={paneOrder} paneCount={leaves.length} />;
}

function NodeView({ node, ...rest }: TerminalSplitProps) {
  if (node.type === "leaf") return <LeafView leaf={node} {...rest} />;
  return <GroupView group={node} {...rest} />;
}

function LeafView({
  leaf,
  focusedPaneId,
  onFocusPane,
  renderPane,
  paneOrder,
  paneCount,
}: SplitChildProps & { leaf: SplitLeaf }) {
  const focused = leaf.id === focusedPaneId;
  const index = paneOrder?.get(leaf.id);
  const showIndex = (paneCount ?? 1) > 1 && index != null;
  return (
    <div
      className="cd-term-pane flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      data-pane-id={leaf.id}
      data-pane-index={index}
      data-focused={focused}
      onPointerDownCapture={() => onFocusPane(leaf.id)}
      onFocusCapture={() => onFocusPane(leaf.id)}
    >
      {showIndex && (
        <button
          type="button"
          className="cd-term-pane-index"
          data-active={focused}
          aria-label={`Select pane ${index}`}
          title={`Select pane ${index}`}
          onClick={(e) => {
            e.stopPropagation();
            onFocusPane(leaf.id);
          }}
        >
          {index}
        </button>
      )}
      {renderPane(leaf)}
    </div>
  );
}

function GroupView({ group, ...rest }: SplitChildProps & { group: SplitGroup }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isRow = group.dir === "row";
  const { onResize } = rest;

  return (
    <div
      ref={containerRef}
      className={`flex min-h-0 min-w-0 flex-1 ${isRow ? "flex-row" : "flex-col"}`}
    >
      {group.children.map((child, i) => (
        <React.Fragment key={child.id}>
          <div
            className="flex min-h-0 min-w-0"
            style={{ flexGrow: group.sizes[i] ?? 1 / group.children.length, flexBasis: 0 }}
          >
            <NodeView node={child} {...rest} />
          </div>
          {i < group.children.length - 1 && (
            <Divider
              dir={group.dir}
              containerRef={containerRef}
              onDrag={(deltaFrac) => {
                const sizes = [...group.sizes];
                const total = (sizes[i] ?? 0) + (sizes[i + 1] ?? 0);
                let a = (sizes[i] ?? 0) + deltaFrac;
                let b = (sizes[i + 1] ?? 0) - deltaFrac;
                a = Math.max(MIN_PANE_FRACTION, Math.min(total - MIN_PANE_FRACTION, a));
                b = total - a;
                sizes[i] = a;
                sizes[i + 1] = b;
                onResize(group.id, sizes);
              }}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

function Divider({
  dir,
  containerRef,
  onDrag,
}: {
  dir: SplitDir;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onDrag: (deltaFrac: number) => void;
}) {
  const isRow = dir === "row";
  const [dragging, setDragging] = useState(false);
  const last = useRef(0);

  const handleDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      last.current = isRow ? e.clientX : e.clientY;
      setDragging(true);
    },
    [isRow],
  );

  const handleMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      const rect = containerRef.current?.getBoundingClientRect();
      const span = rect ? (isRow ? rect.width : rect.height) : 0;
      if (span <= 0) return;
      const pos = isRow ? e.clientX : e.clientY;
      const deltaPx = pos - last.current;
      last.current = pos;
      onDrag(deltaPx / span);
    },
    [dragging, isRow, containerRef, onDrag],
  );

  const stop = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    setDragging(false);
  }, []);

  return (
    <div
      className={`cd-term-divider ${isRow ? "cd-term-divider--row" : "cd-term-divider--col"}`}
      data-dragging={dragging}
      role="separator"
      aria-orientation={isRow ? "vertical" : "horizontal"}
      aria-label="Resize panes"
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={stop}
      onPointerCancel={stop}
    />
  );
}

export default TerminalSplit;
