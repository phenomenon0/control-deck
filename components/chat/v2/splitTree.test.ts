import { describe, expect, test } from "bun:test";

import {
  allLeaves,
  clampSizes,
  closePane,
  countLeaves,
  firstLeaf,
  makeLeaf,
  nearestInDirection,
  pruneSessions,
  setSizes,
  splitLeaf,
  type Rect,
  type SplitGroup,
  type SplitNode,
} from "./splitTree";
import { isUsableTerminalSize } from "./paneFit";

/* ── helpers ──────────────────────────────────────────────────────────────── */

/**
 * Assert every group's sizes sum to ~1, match child count, and stay strictly
 * positive (no pane ever vanishes). Note: `clampSizes` clamps to MIN_PANE_FRACTION
 * then renormalizes, so a size CAN dip slightly below MIN after normalization when
 * a sibling is huge — that's acceptable (pane still visible), so we assert > 0, not
 * ≥ MIN. The per-pair drag clamp (TerminalSplit) does keep both sides ≥ MIN.
 */
function assertSizeInvariant(node: SplitNode): void {
  if (node.type === "leaf") return;
  expect(node.sizes).toHaveLength(node.children.length);
  const sum = node.sizes.reduce((a, b) => a + b, 0);
  expect(Math.abs(sum - 1)).toBeLessThan(1e-6);
  for (const s of node.sizes) expect(s).toBeGreaterThan(0);
  node.children.forEach(assertSizeInvariant);
}

function asGroup(node: SplitNode): SplitGroup {
  if (node.type !== "group") throw new Error("expected a group");
  return node;
}

/* ── splitLeaf ───────────────────────────────────────────────────────────── */

describe("splitLeaf", () => {
  test("wraps a bare top-level leaf into a group of two", () => {
    const leaf = makeLeaf("s1");
    const { tree, newPaneId } = splitLeaf(leaf, leaf.id, "row", "s2");
    const g = asGroup(tree);
    expect(g.dir).toBe("row");
    expect(g.children).toHaveLength(2);
    expect(g.sizes).toEqual([0.5, 0.5]);
    expect(allLeaves(g).map((l) => l.id)).toContain(newPaneId);
    expect(allLeaves(g).map((l) => l.sessionId)).toEqual(["s1", "s2"]);
  });

  test("appends adjacent when the parent group runs the same direction", () => {
    const a = makeLeaf("s1");
    const { tree: t1 } = splitLeaf(a, a.id, "row", "s2"); // [A,B] row
    const g1 = asGroup(t1);
    const bId = g1.children[1].id;
    const { tree: t2 } = splitLeaf(g1, bId, "row", "s3"); // append C adjacent to B
    const g2 = asGroup(t2);
    expect(g2.children).toHaveLength(3); // stays shallow — no nested group
    expect(g2.children.every((c) => c.type === "leaf")).toBe(true);
    // B's slice (0.5) split in two → [0.5, 0.25, 0.25]
    expect(g2.sizes[0]).toBeCloseTo(0.5, 6);
    expect(g2.sizes[1]).toBeCloseTo(0.25, 6);
    expect(g2.sizes[2]).toBeCloseTo(0.25, 6);
    assertSizeInvariant(g2);
  });

  test("wraps the target in a sub-group when splitting cross-direction", () => {
    const a = makeLeaf("s1");
    const { tree: t1 } = splitLeaf(a, a.id, "row", "s2"); // [A,B] row
    const g1 = asGroup(t1);
    const bId = g1.children[1].id;
    const { tree: t2 } = splitLeaf(g1, bId, "col", "s3"); // split B down → nested col group
    const g2 = asGroup(t2);
    expect(g2.children).toHaveLength(2);
    expect(g2.children[0].type).toBe("leaf");
    const nested = asGroup(g2.children[1]);
    expect(nested.dir).toBe("col");
    expect(nested.children).toHaveLength(2);
    expect(countLeaves(g2)).toBe(3);
    assertSizeInvariant(g2);
  });

  test("supports deep 3-4 level nesting while keeping the size invariant", () => {
    let tree: SplitNode = makeLeaf("s1");
    let target = tree.id;
    const dirs = ["row", "col", "row", "col"] as const;
    for (let i = 0; i < dirs.length; i++) {
      const res = splitLeaf(tree, target, dirs[i], `s${i + 2}`);
      tree = res.tree;
      target = res.newPaneId; // keep splitting the freshly created pane → zig-zag nesting
    }
    expect(countLeaves(tree)).toBe(5);
    assertSizeInvariant(tree);
  });
});

/* ── setSizes + clampSizes ───────────────────────────────────────────────── */

describe("setSizes / clampSizes", () => {
  test("clampSizes lifts a tiny pane off zero and renormalizes to 1", () => {
    // Clamps to MIN before normalizing, so the result is >0 (pane stays visible)
    // and the sizes sum to 1 — it may dip just under MIN after normalization.
    const out = clampSizes([0.02, 0.98]);
    expect(out[0]).toBeGreaterThan(0.02); // lifted up from the tiny input
    expect(out[0]).toBeGreaterThan(0);
    expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });

  test("setSizes updates only the matching group, clamped", () => {
    const a = makeLeaf("s1");
    const { tree } = splitLeaf(a, a.id, "row", "s2");
    const g = asGroup(tree);
    const next = asGroup(setSizes(tree, g.id, [0.8, 0.2]));
    expect(next.sizes[0]).toBeCloseTo(0.8, 6);
    expect(next.sizes[1]).toBeCloseTo(0.2, 6);
    assertSizeInvariant(next);
  });

  test("setSizes keeps an over-shrunk pane visible (never collapses to 0)", () => {
    const a = makeLeaf("s1");
    const { tree } = splitLeaf(a, a.id, "row", "s2");
    const g = asGroup(tree);
    const next = asGroup(setSizes(tree, g.id, [0.001, 0.999]));
    expect(next.sizes[0]).toBeGreaterThan(0.001); // lifted off the tiny request
    assertSizeInvariant(next);
  });

  test("setSizes leaves a non-matching group untouched", () => {
    const a = makeLeaf("s1");
    const { tree } = splitLeaf(a, a.id, "row", "s2");
    const same = setSizes(tree, "no-such-group", [0.9, 0.1]);
    expect(asGroup(same).sizes).toEqual([0.5, 0.5]);
  });
});

/* ── closePane ───────────────────────────────────────────────────────────── */

describe("closePane", () => {
  test("returns null when the only pane is closed", () => {
    const a = makeLeaf("s1");
    expect(closePane(a, a.id)).toBeNull();
  });

  test("collapses a singleton group into its remaining child", () => {
    const a = makeLeaf("s1");
    const { tree } = splitLeaf(a, a.id, "row", "s2");
    const g = asGroup(tree);
    const bId = g.children[1].id;
    const next = closePane(tree, bId);
    expect(next?.type).toBe("leaf");
    expect((next as { sessionId: string }).sessionId).toBe("s1");
  });

  test("redistributes the closed pane's space among survivors", () => {
    // [A,B,C] row at [0.5,0.25,0.25]; close A → B,C keep ratio, sum stays 1.
    const a = makeLeaf("s1");
    let tree = splitLeaf(a, a.id, "row", "s2").tree;
    const g1 = asGroup(tree);
    tree = splitLeaf(tree, g1.children[1].id, "row", "s3").tree;
    const g2 = asGroup(tree);
    const aId = g2.children[0].id;
    const next = asGroup(closePane(tree, aId)!);
    expect(next.children).toHaveLength(2);
    assertSizeInvariant(next);
  });
});

/* ── splitLeaf — breaking cases ──────────────────────────────────────────── */

describe("splitLeaf — breaking cases", () => {
  test("repeated same-direction split of ONE pane stays usable (clamped, never collapses)", () => {
    // Each same-dir split halves the target's slice (0.5→0.25→0.125…). Unbounded
    // that vanishes the pane; clampSizes keeps it usable.
    let tree: SplitNode = makeLeaf("s1");
    tree = splitLeaf(tree, tree.id, "row", "s2").tree; // [s1, s2]
    const s1Id = asGroup(tree).children[0].id;
    for (let i = 3; i <= 8; i++) tree = splitLeaf(tree, s1Id, "row", `s${i}`).tree; // keep splitting s1

    const g = asGroup(tree);
    expect(g.children).toHaveLength(8); // 2 + 6 same-pane splits
    assertSizeInvariant(g); // sum≈1, all > 0
    // Without the clamp s1's slice would be 0.5/2^5 ≈ 0.0156; clamped it stays
    // comfortably bigger so the pane is still a real, grabbable box.
    expect(Math.min(...g.sizes)).toBeGreaterThan(0.05);
  });

  test("many siblings: 12 panes in a row all stay visible (>10 defeats the hard MIN but none vanish)", () => {
    let tree: SplitNode = makeLeaf("s1");
    tree = splitLeaf(tree, tree.id, "row", "s2").tree;
    for (let i = 3; i <= 12; i++) {
      const g = asGroup(tree);
      const lastId = g.children[g.children.length - 1].id;
      tree = splitLeaf(tree, lastId, "row", `s${i}`).tree;
    }
    const g = asGroup(tree);
    expect(g.children).toHaveLength(12);
    assertSizeInvariant(g);
    for (const s of g.sizes) expect(s).toBeGreaterThan(0); // documents the >10 limit: tiny but never 0
  });

  test("closing the deepest pane in a zig-zag tree collapses its singleton group", () => {
    let tree: SplitNode = makeLeaf("s1");
    let target = tree.id;
    for (const [i, dir] of (["row", "col", "row", "col"] as const).entries()) {
      const res = splitLeaf(tree, target, dir, `s${i + 2}`);
      tree = res.tree;
      target = res.newPaneId;
    }
    expect(countLeaves(tree)).toBe(5);
    const after = closePane(tree, target)!; // remove the deepest leaf
    expect(after).not.toBeNull();
    expect(countLeaves(after)).toBe(4);
    assertSizeInvariant(after);
  });

  test("closing every pane one by one ends at null (caller closes the tab)", () => {
    let tree: SplitNode | null = makeLeaf("s1");
    tree = splitLeaf(tree, tree.id, "row", "s2").tree;
    tree = splitLeaf(tree, asGroup(tree).children[0].id, "col", "s3").tree;
    // 3 panes → close until nothing remains
    let guard = 0;
    while (tree && guard++ < 10) {
      const leaf = allLeaves(tree)[0];
      tree = closePane(tree, leaf.id);
      if (tree) assertSizeInvariant(tree);
    }
    expect(tree).toBeNull();
  });
});

/* ── pruneSessions ───────────────────────────────────────────────────────── */

describe("pruneSessions", () => {
  test("keeps valid + null-session leaves, drops gone ones", () => {
    const a = makeLeaf("s1");
    let tree = splitLeaf(a, a.id, "row", "s2").tree;
    const g = asGroup(tree);
    tree = splitLeaf(tree, g.children[1].id, "row", "s3").tree;
    const pruned = pruneSessions(tree, new Set(["s1", "s3"])); // s2 gone
    const ids = allLeaves(pruned!).map((l) => l.sessionId);
    expect(ids).toContain("s1");
    expect(ids).toContain("s3");
    expect(ids).not.toContain("s2");
    assertSizeInvariant(pruned!);
  });

  test("keeps empty (null) panes regardless of the valid set", () => {
    const empty = makeLeaf(null);
    expect(pruneSessions(empty, new Set())).toEqual(empty);
  });

  test("returns null when nothing valid remains", () => {
    const a = makeLeaf("s1");
    expect(pruneSessions(a, new Set(["other"]))).toBeNull();
  });
});

/* ── queries + spatial nav ───────────────────────────────────────────────── */

describe("queries + nearestInDirection", () => {
  test("firstLeaf returns the leftmost-deepest leaf", () => {
    const a = makeLeaf("s1");
    const { tree } = splitLeaf(a, a.id, "row", "s2");
    expect(firstLeaf(tree).sessionId).toBe("s1");
  });

  test("nearestInDirection picks the adjacent pane by geometry", () => {
    // 2x2 grid of rects.
    const rects: Record<string, Rect> = {
      tl: { x: 0, y: 0, w: 100, h: 100 },
      tr: { x: 100, y: 0, w: 100, h: 100 },
      bl: { x: 0, y: 100, w: 100, h: 100 },
      br: { x: 100, y: 100, w: 100, h: 100 },
    };
    expect(nearestInDirection(rects, "tl", "right")).toBe("tr");
    expect(nearestInDirection(rects, "tl", "down")).toBe("bl");
    expect(nearestInDirection(rects, "br", "left")).toBe("bl");
    expect(nearestInDirection(rects, "br", "up")).toBe("tr");
    expect(nearestInDirection(rects, "tl", "left")).toBeNull();
  });
});

/* ── isUsableTerminalSize (resize guard) ─────────────────────────────────── */

describe("isUsableTerminalSize", () => {
  test("rejects collapsed / degenerate sizes", () => {
    expect(isUsableTerminalSize(0, 0)).toBe(false);
    expect(isUsableTerminalSize(1, 1)).toBe(false);
    expect(isUsableTerminalSize(80, 1)).toBe(false);
    expect(isUsableTerminalSize(1, 24)).toBe(false);
    expect(isUsableTerminalSize(NaN, 24)).toBe(false);
    expect(isUsableTerminalSize(80, Infinity)).toBe(false);
  });

  test("accepts real terminal sizes", () => {
    expect(isUsableTerminalSize(2, 2)).toBe(true);
    expect(isUsableTerminalSize(80, 24)).toBe(true);
    expect(isUsableTerminalSize(120, 36)).toBe(true);
  });
});
