import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import { useCallback, useEffect, useRef, useState } from "react";

import { TerminalSplit } from "./TerminalSplit";
import {
  makeLeaf,
  nearestInDirection,
  setSizes,
  splitLeaf,
  type FocusDir,
  type Rect,
  type SplitLeaf,
  type SplitNode,
} from "./splitTree";

/**
 * Verifies the split layout primitive with faux panes (no live PTY): pane count,
 * dividers, click-to-focus, and ⌘+arrow geometry-based focus navigation. The
 * harness mirrors what TerminalContainer will own (tree + focus + ⌘-arrow).
 */
const meta = {
  title: "chat/v2/Terminal/Split",
  component: TerminalSplit,
  parameters: { layout: "fullscreen" },
  tags: ["ai-generated"],
} satisfies Meta<typeof TerminalSplit>;

export default meta;
type Story = StoryObj<typeof meta>;

const KEY_TO_DIR: Record<string, FocusDir> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

function SplitHarness({ initial }: { initial: SplitNode }) {
  const [tree, setTree] = useState<SplitNode>(initial);
  const [focused, setFocused] = useState<string>(() => firstId(initial));
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.altKey)) return;
      const dir = KEY_TO_DIR[e.key];
      if (!dir) return;
      e.preventDefault();
      const root = rootRef.current;
      if (!root) return;
      const rects: Record<string, Rect> = {};
      root.querySelectorAll<HTMLElement>("[data-pane-id]").forEach((el) => {
        const id = el.dataset.paneId!;
        const r = el.getBoundingClientRect();
        rects[id] = { x: r.x, y: r.y, w: r.width, h: r.height };
      });
      const next = nearestInDirection(rects, focused, dir);
      if (next) setFocused(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focused]);

  const renderPane = useCallback(
    (leaf: SplitLeaf) => (
      <div
        className="flex h-full w-full items-center justify-center text-[var(--text-secondary)]"
        style={{ fontFamily: "var(--font-mono)", fontSize: 12, background: "var(--bg-inset, var(--bg))" }}
      >
        {leaf.sessionId ?? "empty"}
      </div>
    ),
    [],
  );

  return (
    <div ref={rootRef} style={{ height: 360, width: "100%", display: "flex" }}>
      <TerminalSplit
        node={tree}
        focusedPaneId={focused}
        onFocusPane={setFocused}
        onResize={(groupId, sizes) => setTree((t) => setSizes(t, groupId, sizes))}
        renderPane={renderPane}
      />
    </div>
  );
}

function firstId(node: SplitNode): string {
  return node.type === "leaf" ? node.id : firstId(node.children[0]);
}

const pa = makeLeaf("alpha", "pa");
const pb = makeLeaf("bravo", "pb");
const pc = makeLeaf("charlie", "pc");
const pd = makeLeaf("delta", "pd");

const rowTree: SplitNode = { type: "group", id: "g-row", dir: "row", children: [pa, pb], sizes: [0.5, 0.5] };
const colTree: SplitNode = { type: "group", id: "g-col", dir: "col", children: [pa, pb], sizes: [0.5, 0.5] };
const gridTree: SplitNode = {
  type: "group",
  id: "g-grid",
  dir: "row",
  sizes: [0.5, 0.5],
  children: [
    { type: "group", id: "g-l", dir: "col", children: [pa, pb], sizes: [0.5, 0.5] },
    { type: "group", id: "g-r", dir: "col", children: [pc, pd], sizes: [0.5, 0.5] },
  ],
};

export const RowSplit: Story = {
  render: () => <SplitHarness initial={rowTree} />,
  play: async ({ canvasElement }) => {
    const root = within(canvasElement);
    await expect(canvasElement.querySelectorAll("[data-pane-id]")).toHaveLength(2);
    await expect(root.getAllByRole("separator")).toHaveLength(1);
    await expect(root.getByRole("separator")).toHaveAttribute("aria-orientation", "vertical");
  },
};

export const ColSplit: Story = {
  render: () => <SplitHarness initial={colTree} />,
  play: async ({ canvasElement }) => {
    const root = within(canvasElement);
    await expect(root.getByRole("separator")).toHaveAttribute("aria-orientation", "horizontal");
  },
};

export const NestedGrid: Story = {
  render: () => <SplitHarness initial={gridTree} />,
  play: async ({ canvasElement, userEvent }) => {
    await expect(canvasElement.querySelectorAll("[data-pane-id]")).toHaveLength(4);
    // 3 dividers: 1 outer (row) + 2 inner (col).
    await expect(within(canvasElement).getAllByRole("separator")).toHaveLength(3);

    const paneOf = (id: string) => canvasElement.querySelector<HTMLElement>(`[data-pane-id="${id}"]`)!;
    // Focus starts on pa (top-left). ⌘→ should jump to the right column's top (pc).
    await expect(paneOf("pa")).toHaveAttribute("data-focused", "true");
    await userEvent.keyboard("{Meta>}{ArrowRight}{/Meta}");
    await expect(paneOf("pc")).toHaveAttribute("data-focused", "true");
    // ⌘↓ within the right column → pd.
    await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");
    await expect(paneOf("pd")).toHaveAttribute("data-focused", "true");
  },
};

export const ClickToFocus: Story = {
  render: () => <SplitHarness initial={rowTree} />,
  play: async ({ canvasElement, userEvent }) => {
    const paneOf = (id: string) => canvasElement.querySelector<HTMLElement>(`[data-pane-id="${id}"]`)!;
    await expect(paneOf("pa")).toHaveAttribute("data-focused", "true");
    await userEvent.click(paneOf("pb"));
    await expect(paneOf("pb")).toHaveAttribute("data-focused", "true");
    await expect(paneOf("pa")).toHaveAttribute("data-focused", "false");
  },
};

/* ── resize: dividers must move sizes correctly without text vanishing ─────── */

type PlayUserEvent = Parameters<NonNullable<Story["play"]>>[0]["userEvent"];

/** Drag a divider by (dx, dy) px via real pointer events (drives pointer capture
 *  + the Divider's onPointerDown/Move/Up, so `dragging` state flushes between). */
async function dragDivider(userEvent: PlayUserEvent, divider: HTMLElement, dx: number, dy: number) {
  const r = divider.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  await userEvent.pointer([
    { keys: "[MouseLeft>]", target: divider, coords: { x, y } },
    { coords: { x: x + dx, y: y + dy } },
    { keys: "[/MouseLeft]" },
  ]);
}

const paneEl = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`[data-pane-id="${id}"]`)!;

export const DividerDragResize: Story = {
  name: "Drag divider (row) — sizes move, text stays",
  render: () => <SplitHarness initial={rowTree} />,
  play: async ({ canvasElement, userEvent }) => {
    const within_ = within(canvasElement);
    const divider = within_.getByRole("separator");
    const a = () => paneEl(canvasElement, "pa");
    const b = () => paneEl(canvasElement, "pb");

    // Start ~50/50.
    await expect(Math.abs(a().offsetWidth - b().offsetWidth)).toBeLessThan(8);

    // Drag right → left pane grows, right shrinks; both stay visible.
    await dragDivider(userEvent, divider, 140, 0);
    await expect(a().offsetWidth).toBeGreaterThan(b().offsetWidth);
    await expect(a().offsetWidth).toBeGreaterThan(0);
    await expect(b().offsetWidth).toBeGreaterThan(0);

    // Text content didn't disappear during/after the resize.
    await expect(a().textContent).toContain("alpha");
    await expect(b().textContent).toContain("bravo");
  },
};

export const ColSplitDragResize: Story = {
  name: "Drag divider (col) — heights move, text stays",
  render: () => <SplitHarness initial={colTree} />,
  play: async ({ canvasElement, userEvent }) => {
    const divider = within(canvasElement).getByRole("separator");
    const a = () => paneEl(canvasElement, "pa");
    const b = () => paneEl(canvasElement, "pb");

    await dragDivider(userEvent, divider, 0, 90);
    await expect(a().offsetHeight).toBeGreaterThan(b().offsetHeight);
    await expect(a().offsetHeight).toBeGreaterThan(0);
    await expect(b().offsetHeight).toBeGreaterThan(0);
    await expect(a().textContent).toContain("alpha");
    await expect(b().textContent).toContain("bravo");
  },
};

export const DragClampsAtMin: Story = {
  name: "Drag past the edge — clamps, pane never vanishes",
  render: () => <SplitHarness initial={rowTree} />,
  play: async ({ canvasElement, userEvent }) => {
    const divider = within(canvasElement).getByRole("separator");
    const a = () => paneEl(canvasElement, "pa");
    const b = () => paneEl(canvasElement, "pb");

    // Yank the divider far left, well past pane A's min — A must clamp, not vanish.
    await dragDivider(userEvent, divider, -5000, 0);
    await expect(a().offsetWidth).toBeGreaterThan(0);
    await expect(b().offsetWidth).toBeGreaterThan(a().offsetWidth);
    await expect(a().textContent).toContain("alpha"); // still rendered
  },
};

export const NestedResizeIsolated: Story = {
  name: "Nested resize — inner drag doesn't move outer panes",
  render: () => <SplitHarness initial={gridTree} />,
  play: async ({ canvasElement, userEvent }) => {
    const a = () => paneEl(canvasElement, "pa"); // left col, top
    const c = () => paneEl(canvasElement, "pc"); // right col, top

    // Left & right columns start equal width.
    const aw0 = a().offsetWidth;
    const cw0 = c().offsetWidth;
    await expect(Math.abs(aw0 - cw0)).toBeLessThan(8);

    // Drag the LEFT column's inner (horizontal) divider down.
    const innerCol = canvasElement.querySelectorAll<HTMLElement>('[role="separator"][aria-orientation="horizontal"]')[0];
    await dragDivider(userEvent, innerCol, 0, 80);

    // Inner change affects heights within the left column…
    await expect(a().offsetHeight).toBeGreaterThan(paneEl(canvasElement, "pb").offsetHeight);
    // …but the OUTER column widths are untouched (panes don't "move weird").
    await expect(Math.abs(a().offsetWidth - aw0)).toBeLessThan(2);
    await expect(Math.abs(c().offsetWidth - cw0)).toBeLessThan(2);
  },
};

// A deeply-nested tree (the shape you get after many alternating splits): every
// pane must still render its text and occupy a real, non-zero box.
const deepTree: SplitNode = (() => {
  let t = makeLeaf("t1") as SplitNode;
  let target = t.id;
  for (const [i, dir] of (["row", "col", "row", "col"] as const).entries()) {
    const res = splitLeaf(t, target, dir, `t${i + 2}`);
    t = res.tree;
    target = res.newPaneId;
  }
  return t;
})();

export const TextStableAcrossManySplits: Story = {
  name: "Deep nesting — every pane keeps text + size",
  render: () => <SplitHarness initial={deepTree} />,
  play: async ({ canvasElement }) => {
    const panes = Array.from(canvasElement.querySelectorAll<HTMLElement>("[data-pane-id]"));
    await expect(panes).toHaveLength(5);
    const text = canvasElement.textContent ?? "";
    for (let i = 1; i <= 5; i++) await expect(text).toContain(`t${i}`);
    for (const p of panes) {
      await expect(p.offsetWidth).toBeGreaterThan(0);
      await expect(p.offsetHeight).toBeGreaterThan(0);
    }
  },
};

/* ── breaking cases: many panes, indices, tiny panes ───────────────────────── */

// 11 panes appended into one row (the "I keep hitting split" case). With the
// splitLeaf clamp none collapse; the layout must stay legible — every pane a
// real box carrying its tmux #P index badge.
const manyRow: SplitNode = (() => {
  let t: SplitNode = makeLeaf("m1");
  for (let i = 2; i <= 11; i++) {
    const lastId = t.type === "leaf" ? t.id : t.children[t.children.length - 1].id;
    t = splitLeaf(t, lastId, "row", `m${i}`).tree;
  }
  return t;
})();

export const ManyPanesInARow: Story = {
  name: "Many panes (11) in a row — all visible + indexed",
  render: () => <SplitHarness initial={manyRow} />,
  play: async ({ canvasElement }) => {
    const panes = Array.from(canvasElement.querySelectorAll<HTMLElement>("[data-pane-id]"));
    await expect(panes).toHaveLength(11);
    for (const p of panes) await expect(p.offsetWidth).toBeGreaterThan(0); // none collapsed
    // 10 dividers between 11 panes.
    await expect(within(canvasElement).getAllByRole("separator")).toHaveLength(10);
    // every pane shows its #P index badge (0..10).
    const badges = Array.from(canvasElement.querySelectorAll<HTMLElement>(".cd-term-pane-index"));
    await expect(badges).toHaveLength(11);
    await expect(badges.map((b) => b.textContent)).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
  },
};

export const PaneIndexBadges: Story = {
  name: "Pane index badges — shown when split, active highlighted, clickable",
  render: () => <SplitHarness initial={gridTree} />,
  play: async ({ canvasElement, userEvent }) => {
    const badges = Array.from(canvasElement.querySelectorAll<HTMLElement>(".cd-term-pane-index"));
    await expect(badges).toHaveLength(4);
    await expect(badges.map((b) => b.textContent)).toEqual(["0", "1", "2", "3"]);
    // pa (index 0) is focused at start → its badge is the active one.
    await expect(badges[0]).toHaveAttribute("data-active", "true");
    // clicking another badge moves focus (and the active highlight) to that pane.
    await userEvent.click(badges[2]);
    await expect(badges[2]).toHaveAttribute("data-active", "true");
    await expect(badges[0]).toHaveAttribute("data-active", "false");
    await expect(canvasElement.querySelector('[data-pane-id="pc"]')).toHaveAttribute("data-focused", "true");
  },
};

// A pane sized to the minimum fraction must still be a real, grabbable box with
// a working index badge — the layout shouldn't squeeze it out of existence.
const tinyTree: SplitNode = {
  type: "group",
  id: "g-tiny",
  dir: "row",
  children: [makeLeaf("big", "big"), makeLeaf("tiny", "tiny")],
  sizes: [0.9, 0.1],
};

export const TinyPaneStaysUsable: Story = {
  name: "Min-size pane — still a focusable box with its badge",
  render: () => <SplitHarness initial={tinyTree} />,
  play: async ({ canvasElement, userEvent }) => {
    const tiny = canvasElement.querySelector<HTMLElement>('[data-pane-id="tiny"]')!;
    await expect(tiny.offsetWidth).toBeGreaterThan(0);
    const badge = tiny.querySelector<HTMLElement>(".cd-term-pane-index")!;
    await expect(badge).not.toBeNull();
    await userEvent.click(badge);
    await expect(tiny).toHaveAttribute("data-focused", "true");
  },
};

/* ── no-remount proof: the load-bearing guard against blank-on-split ───────── */

// Harness that splits via a real button so `play` can drive it, and tags each
// pane's content with a stable `data-probe` node. The blank-on-split bug was a
// REMOUNT: splitting wrapped a leaf in a new group, swapping the component type
// at that slot so React tore down + rebuilt the pane (and its live terminal).
// The flat layout keeps each pane's React position stable, so the SAME DOM node
// is reused. Asserting node identity (===) is the only check that distinguishes
// the two implementations.
function ProbeSplitHarness({ initial, splitId, splitDir }: { initial: SplitNode; splitId: string; splitDir: "row" | "col" }) {
  const [tree, setTree] = useState<SplitNode>(initial);
  const [focused, setFocused] = useState<string>(() => firstId(initial));
  const renderPane = useCallback(
    (leaf: SplitLeaf) => (
      <div
        data-probe={leaf.id}
        className="flex h-full w-full items-center justify-center text-[var(--text-secondary)]"
        style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}
      >
        {leaf.sessionId}
      </div>
    ),
    [],
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", height: 360, width: "100%" }}>
      <button
        type="button"
        data-testid="do-split"
        onClick={() => {
          const r = splitLeaf(tree, splitId, splitDir, "newsession");
          setTree(r.tree);
          setFocused(r.newPaneId);
        }}
      >
        split
      </button>
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <TerminalSplit node={tree} focusedPaneId={focused} onFocusPane={setFocused} onResize={(g, s) => setTree((t) => setSizes(t, g, s))} renderPane={renderPane} />
      </div>
    </div>
  );
}

export const SplitDoesNotRemountExistingPane: Story = {
  name: "Split a bare leaf — existing pane DOM node is REUSED, not remounted",
  render: () => <ProbeSplitHarness initial={makeLeaf("alpha", "pa")} splitId="pa" splitDir="row" />,
  play: async ({ canvasElement, userEvent }) => {
    const probeBefore = canvasElement.querySelector('[data-probe="pa"]');
    const frameBefore = canvasElement.querySelector('[data-pane-id="pa"]');
    await expect(probeBefore).not.toBeNull();

    await userEvent.click(canvasElement.querySelector('[data-testid="do-split"]')!);

    await expect(canvasElement.querySelectorAll("[data-pane-id]")).toHaveLength(2);
    // load-bearing: the SAME DOM nodes persist → React reconciled, never remounted.
    await expect(canvasElement.querySelector('[data-probe="pa"]')).toBe(probeBefore);
    await expect(canvasElement.querySelector('[data-pane-id="pa"]')).toBe(frameBefore);
  },
};

export const NestedWrapDoesNotRemount: Story = {
  name: "Cross-direction split (leaf→sub-group wrap) — neither pane remounts",
  render: () => (
    <ProbeSplitHarness
      initial={{ type: "group", id: "g", dir: "row", children: [makeLeaf("alpha", "pa"), makeLeaf("bravo", "pb")], sizes: [0.5, 0.5] }}
      splitId="pb"
      splitDir="col"
    />
  ),
  play: async ({ canvasElement, userEvent }) => {
    const a = canvasElement.querySelector('[data-probe="pa"]');
    const b = canvasElement.querySelector('[data-probe="pb"]');
    await expect(a).not.toBeNull();
    await expect(b).not.toBeNull();

    // splitting pb wraps it into a NEW nested col group — the riskiest restructure
    await userEvent.click(canvasElement.querySelector('[data-testid="do-split"]')!);

    await expect(canvasElement.querySelectorAll("[data-pane-id]")).toHaveLength(3);
    // both the wrapped pane AND its untouched sibling keep their exact DOM nodes
    await expect(canvasElement.querySelector('[data-probe="pb"]')).toBe(b);
    await expect(canvasElement.querySelector('[data-probe="pa"]')).toBe(a);
  },
};
