/**
 * Failure envelope for `native_*` tool errors.
 *
 * When a native_* tool fails, the agent has nothing to go on beyond
 * an error string. A screenshot + a shallow tree snippet of the
 * active window turn "locate failed" into a post-mortem the agent
 * can reason about — "I can see the dialog is off-screen", "the
 * target app is crash-dumping", "focus jumped to a different app",
 * etc.
 *
 * Gated behind the `CONTROL_DECK_FAILURE_ENVELOPES` env var. Off by
 * default — screenshots + trees are 50-500KB each, and bloating
 * every error response would hurt the chat UI + LLM context.
 *
 * Enable per-session:  CONTROL_DECK_FAILURE_ENVELOPES=1 bun run dev
 */

import type { NativeAdapter, TreeNode } from "./types";

export interface FailureEnvelope {
  capturedAt: string;
  /** Base64 PNG + dims. Omitted if screen capture fails. */
  screenshot?: { pngBase64: string; width: number; height: number };
  /**
   * Lightweight tree summary rooted at the desktop — just
   * {role, name, childCount} per node, bounded depth, to keep token
   * cost sane. Omitted if getTree fails.
   */
  desktopTreeSummary?: TreeSummary;
}

export interface TreeSummary {
  role?: string;
  name?: string;
  childCount: number;
  children?: TreeSummary[];
}

const MAX_TREE_DEPTH = 3;
const MAX_CHILDREN_PER_NODE = 12;

function summarizeTree(node: TreeNode, depth = 0): TreeSummary {
  const children = node.children ?? [];
  const summary: TreeSummary = {
    role: node.handle?.role,
    name: node.handle?.name,
    childCount: children.length,
  };
  if (depth < MAX_TREE_DEPTH && children.length) {
    summary.children = children
      .slice(0, MAX_CHILDREN_PER_NODE)
      .map((c) => summarizeTree(c, depth + 1));
  }
  return summary;
}

/**
 * Build an envelope. Tolerant of partial failure — if screen capture
 * works but tree doesn't (or vice versa), returns what it got.
 */
export async function captureFailureEnvelope(
  adapter: NativeAdapter,
): Promise<FailureEnvelope | undefined> {
  if (process.env.CONTROL_DECK_FAILURE_ENVELOPES !== "1") return undefined;

  const [shot, tree] = await Promise.all([
    (async () => {
      try { return await adapter.screenGrab(); }
      catch { return null; }
    })(),
    (async () => {
      try { return await adapter.getTree(); }
      catch { return null; }
    })(),
  ]);

  return {
    capturedAt: new Date().toISOString(),
    screenshot: shot
      ? { pngBase64: shot.pngBase64, width: shot.width, height: shot.height }
      : undefined,
    desktopTreeSummary: tree ? summarizeTree(tree) : undefined,
  };
}
