import { describe, expect, test } from "bun:test";

import { computeLayout, type PaneBox } from "./TerminalSplit";
import { makeLeaf, splitLeaf, type SplitNode } from "./splitTree";

/** Run the layout pass over a tree → flat pane boxes. */
function layoutOf(tree: SplitNode): PaneBox[] {
  const panes: PaneBox[] = [];
  computeLayout(tree, 0, 0, 1, 1, panes, [], { n: 0 });
  return panes;
}

const EPS = 1e-9;

const pa = makeLeaf("alpha", "pa");
const pb = makeLeaf("bravo", "pb");
const pc = makeLeaf("charlie", "pc");
const pd = makeLeaf("delta", "pd");

const rowTree: SplitNode = { type: "group", id: "g-row", dir: "row", children: [pa, pb], sizes: [0.5, 0.5] };
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

describe("computeLayout — tiling invariants", () => {
  for (const [name, tree, n] of [
    ["row", rowTree, 2],
    ["grid", gridTree, 4],
  ] as const) {
    test(`${name}: panes tile the unit square with no overlap or gap`, () => {
      const panes = layoutOf(tree);
      expect(panes).toHaveLength(n);

      // every pane in-bounds + non-zero
      for (const p of panes) {
        expect(p.x).toBeGreaterThanOrEqual(-EPS);
        expect(p.y).toBeGreaterThanOrEqual(-EPS);
        expect(p.x + p.w).toBeLessThanOrEqual(1 + EPS);
        expect(p.y + p.h).toBeLessThanOrEqual(1 + EPS);
        expect(p.w).toBeGreaterThan(0);
        expect(p.h).toBeGreaterThan(0);
      }

      // total area == 1 (no gaps, no overlap = exact cover)
      const area = panes.reduce((a, p) => a + p.w * p.h, 0);
      expect(Math.abs(area - 1)).toBeLessThan(1e-6);

      // pairwise non-overlap
      for (let i = 0; i < panes.length; i++) {
        for (let j = i + 1; j < panes.length; j++) {
          const a = panes[i];
          const b = panes[j];
          const overlap =
            a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;
          expect(overlap).toBe(false);
        }
      }
    });
  }

  test("uneven sizes are honoured (proportional rects)", () => {
    const t: SplitNode = { type: "group", id: "g", dir: "row", children: [pa, pb, pc], sizes: [0.6, 0.25, 0.15] };
    const panes = layoutOf(t);
    expect(panes.map((p) => p.w)).toEqual([0.6, 0.25, 0.15]);
    expect(panes.map((p) => p.x)).toEqual([0, 0.6, 0.85]);
    for (const p of panes) expect(p.h).toBe(1);
  });
});

describe("computeLayout — tmux #P index stability", () => {
  test("indices are sequential depth-first 0..n-1", () => {
    expect(layoutOf(gridTree).map((p) => p.index)).toEqual([0, 1, 2, 3]);
  });

  test("splitting a LATER pane does not change an earlier pane's #P index", () => {
    const before = layoutOf(rowTree).find((p) => p.leaf.id === "pa")!.index; // 0
    const after = splitLeaf(rowTree, "pb", "row", "s3").tree; // split the second pane
    const idxA = layoutOf(after).find((p) => p.leaf.id === "pa")!.index;
    expect(idxA).toBe(before);
    expect(idxA).toBe(0);
  });
});
