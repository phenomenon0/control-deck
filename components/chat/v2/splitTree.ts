/**
 * splitTree — the pure data model behind the v2 terminal's tmux-style splits.
 *
 * A *tab* owns one SplitNode. A fresh tab is a single leaf; splitting wraps a
 * leaf into a group (or appends to a same-direction parent so nesting stays
 * shallow for the common "3 panes in a row" case). Each leaf maps to at most one
 * sessionId. Everything here is pure + immutable so the container can keep tree
 * state in React and Storybook can drive it without a live PTY.
 *
 *   dir:"row" → children sit side-by-side, divider is vertical
 *   dir:"col" → children stack,           divider is horizontal
 */

export type SplitDir = "row" | "col";

export interface SplitLeaf {
  type: "leaf";
  /** Stable pane id (NOT the session id) — survives session swaps. */
  id: string;
  /** The session shown in this pane, or null for an empty/launcher pane. */
  sessionId: string | null;
}

export interface SplitGroup {
  type: "group";
  id: string;
  dir: SplitDir;
  children: SplitNode[];
  /** Fractions in [0,1], one per child, summing to ~1. */
  sizes: number[];
}

export type SplitNode = SplitLeaf | SplitGroup;

/** Minimum fraction a pane can shrink to (so a pane can never vanish on resize). */
export const MIN_PANE_FRACTION = 0.1;

/* ── id generation ──────────────────────────────────────────────────────── */

let fallbackCounter = 0;
export function genPaneId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `pane-${crypto.randomUUID()}`;
    }
  } catch {
    /* fall through */
  }
  fallbackCounter += 1;
  return `pane-${fallbackCounter}`;
}

export function makeLeaf(sessionId: string | null = null, id?: string): SplitLeaf {
  return { type: "leaf", id: id ?? genPaneId(), sessionId };
}

/* ── queries ────────────────────────────────────────────────────────────── */

export function allLeaves(node: SplitNode): SplitLeaf[] {
  if (node.type === "leaf") return [node];
  return node.children.flatMap(allLeaves);
}

export function firstLeaf(node: SplitNode): SplitLeaf {
  return node.type === "leaf" ? node : firstLeaf(node.children[0]);
}

export function findLeaf(node: SplitNode, paneId: string): SplitLeaf | null {
  if (node.type === "leaf") return node.id === paneId ? node : null;
  for (const child of node.children) {
    const hit = findLeaf(child, paneId);
    if (hit) return hit;
  }
  return null;
}

export function leafForSession(node: SplitNode, sessionId: string): SplitLeaf | null {
  return allLeaves(node).find((l) => l.sessionId === sessionId) ?? null;
}

export function countLeaves(node: SplitNode): number {
  return allLeaves(node).length;
}

/* ── size helpers ───────────────────────────────────────────────────────── */

function evenSizes(n: number): number[] {
  return Array.from({ length: n }, () => 1 / n);
}

/** Clamp each size to MIN_PANE_FRACTION, then renormalize to sum 1. */
export function clampSizes(sizes: number[]): number[] {
  if (sizes.length === 0) return sizes;
  const clamped = sizes.map((s) => Math.max(MIN_PANE_FRACTION, s));
  const total = clamped.reduce((a, b) => a + b, 0) || 1;
  return clamped.map((s) => s / total);
}

/* ── mutations (immutable) ──────────────────────────────────────────────── */

/**
 * Split the given pane in `dir`, inserting a fresh leaf (carrying `newSessionId`)
 * next to it. If the pane's parent group already runs in `dir`, the new leaf is
 * appended adjacent (sharing the target's space) to keep nesting shallow;
 * otherwise the target leaf is wrapped in a new group. Returns the new tree and
 * the new leaf's id (so the caller can focus it).
 */
export function splitLeaf(
  tree: SplitNode,
  paneId: string,
  dir: SplitDir,
  newSessionId: string | null = null,
): { tree: SplitNode; newPaneId: string } {
  const newLeaf = makeLeaf(newSessionId);

  function recurse(node: SplitNode): SplitNode {
    // Top-level leaf (no parent group) being split → wrap it.
    if (node.type === "leaf") {
      if (node.id === paneId) {
        return { type: "group", id: genPaneId(), dir, children: [node, newLeaf], sizes: [0.5, 0.5] };
      }
      return node;
    }
    const idx = node.children.findIndex((c) => c.type === "leaf" && c.id === paneId);
    if (idx >= 0) {
      if (node.dir === dir) {
        // Append adjacent, splitting the target's own slice in two.
        const children = [...node.children];
        children.splice(idx + 1, 0, newLeaf);
        const sizes = [...node.sizes];
        const half = sizes[idx] / 2;
        sizes[idx] = half;
        sizes.splice(idx + 1, 0, half);
        // Clamp so repeatedly splitting the same pane can't drive a slice below
        // MIN (halving is unbounded: 0.5→0.25→0.125…). Clamp is a no-op until a
        // slice actually dips under MIN, so normal splits keep exact fractions.
        return { ...node, children, sizes: clampSizes(sizes) };
      }
      // Cross-direction → wrap just the target leaf into a sub-group.
      const children = [...node.children];
      children[idx] = {
        type: "group",
        id: genPaneId(),
        dir,
        children: [node.children[idx], newLeaf],
        sizes: [0.5, 0.5],
      };
      return { ...node, children };
    }
    return { ...node, children: node.children.map(recurse) };
  }

  return { tree: recurse(tree), newPaneId: newLeaf.id };
}

/**
 * Remove a pane. Singleton groups collapse into their remaining child; the
 * removed pane's space is redistributed proportionally among survivors. Returns
 * null if the whole tree is gone (caller closes the tab).
 */
export function closePane(tree: SplitNode, paneId: string): SplitNode | null {
  function recurse(node: SplitNode): SplitNode | null {
    if (node.type === "leaf") return node.id === paneId ? null : node;
    const kept: Array<{ node: SplitNode; size: number }> = [];
    node.children.forEach((child, i) => {
      const next = recurse(child);
      if (next !== null) kept.push({ node: next, size: node.sizes[i] ?? 1 / node.children.length });
    });
    if (kept.length === 0) return null;
    if (kept.length === 1) return kept[0].node; // collapse singleton group
    const keptTotal = kept.reduce((a, p) => a + p.size, 0) || 1;
    const removed = 1 - keptTotal;
    const sizes = clampSizes(kept.map((p) => p.size + removed * (p.size / keptTotal)));
    return { ...node, children: kept.map((p) => p.node), sizes };
  }
  return recurse(tree);
}

/** Replace a group's child sizes (clamped + renormalized). */
export function setSizes(tree: SplitNode, groupId: string, sizes: number[]): SplitNode {
  function recurse(node: SplitNode): SplitNode {
    if (node.type === "leaf") return node;
    if (node.id === groupId) return { ...node, sizes: clampSizes(sizes) };
    return { ...node, children: node.children.map(recurse) };
  }
  return recurse(tree);
}

/** Assign (or clear) the session shown in a pane. */
export function setPaneSession(tree: SplitNode, paneId: string, sessionId: string | null): SplitNode {
  function recurse(node: SplitNode): SplitNode {
    if (node.type === "leaf") return node.id === paneId ? { ...node, sessionId } : node;
    return { ...node, children: node.children.map(recurse) };
  }
  return recurse(tree);
}

/**
 * Drop any leaf whose sessionId is no longer valid (used on rehydrate). Leaves
 * with sessionId === null are kept (empty panes). Returns null if nothing valid
 * remains.
 */
export function pruneSessions(tree: SplitNode, valid: ReadonlySet<string>): SplitNode | null {
  function recurse(node: SplitNode): SplitNode | null {
    if (node.type === "leaf") {
      if (node.sessionId === null || valid.has(node.sessionId)) return node;
      return null;
    }
    const kept: Array<{ node: SplitNode; size: number }> = [];
    node.children.forEach((child, i) => {
      const next = recurse(child);
      if (next !== null) kept.push({ node: next, size: node.sizes[i] ?? 1 / node.children.length });
    });
    if (kept.length === 0) return null;
    if (kept.length === 1) return kept[0].node;
    return { ...node, children: kept.map((p) => p.node), sizes: clampSizes(kept.map((p) => p.size)) };
  }
  return recurse(tree);
}

/* ── spatial focus navigation ───────────────────────────────────────────── */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type FocusDir = "left" | "right" | "up" | "down";

/**
 * Pick the nearest pane in a direction from rendered bounding boxes. Geometry
 * (not tree-walking) so it stays correct under arbitrary nesting. Returns null
 * if no pane lies in that direction.
 */
export function nearestInDirection(
  rects: Record<string, Rect>,
  fromId: string,
  dir: FocusDir,
): string | null {
  const from = rects[fromId];
  if (!from) return null;
  const fx = from.x + from.w / 2;
  const fy = from.y + from.h / 2;

  let best: string | null = null;
  let bestScore = Infinity;
  for (const [id, r] of Object.entries(rects)) {
    if (id === fromId) continue;
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const dx = cx - fx;
    const dy = cy - fy;
    // Must lie predominantly in the requested direction.
    const inDir =
      (dir === "left" && dx < -1 && Math.abs(dx) >= Math.abs(dy)) ||
      (dir === "right" && dx > 1 && Math.abs(dx) >= Math.abs(dy)) ||
      (dir === "up" && dy < -1 && Math.abs(dy) >= Math.abs(dx)) ||
      (dir === "down" && dy > 1 && Math.abs(dy) >= Math.abs(dx));
    if (!inDir) continue;
    // Prefer the closest center, lightly penalizing cross-axis offset.
    const along = dir === "left" || dir === "right" ? Math.abs(dx) : Math.abs(dy);
    const across = dir === "left" || dir === "right" ? Math.abs(dy) : Math.abs(dx);
    const score = along + across * 2;
    if (score < bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}
