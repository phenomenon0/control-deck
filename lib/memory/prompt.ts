/**
 * Prompt-side glue between the memory store and the chat routes.
 *
 * Single entry point: `renderMemoryForPrompt()`. It reads settings, resolves
 * budgets, loads the snapshot, and returns the markdown block to splice
 * into the system prompt — or an empty string when memory is disabled or
 * both files are empty.
 *
 * Reads happen on each call. Within one server invocation there is no
 * caching, but the file content is stable between agent writes so two
 * consecutive turns produce identical text and the KV cache hits.
 *
 * When the `memory()` MCP tool ships (step 3), a write within a turn will
 * change the prompt prefix on the next turn. That is the intended
 * trade-off: writes are durable across turns, frozen within a turn.
 */

import { resolveSection } from "@/lib/settings/resolve";
import { loadMemorySnapshot, renderSnapshot, type SnapshotOpts } from "./snapshot";

export interface RenderMemoryOpts extends SnapshotOpts {
  /** When false, returns "" even if files exist. Default: read settings. */
  enabled?: boolean;
}

/**
 * Render the curated memory block for the current session. Returns "" when
 * the feature is disabled or both files are empty so callers can splice
 * unconditionally without producing dead headings.
 */
export function renderMemoryForPrompt(opts: RenderMemoryOpts = {}): string {
  let settings: { enabled: boolean; budgets: { memory: number; user: number } };
  try {
    settings = resolveSection("memory");
  } catch {
    // Settings DB unreachable (tests / cold boot) — fall back to defaults.
    settings = { enabled: true, budgets: { memory: 2200, user: 1375 } };
  }

  const enabled = opts.enabled ?? settings.enabled;
  if (!enabled) return "";

  const snapshot = loadMemorySnapshot({
    ...opts,
    budgets: opts.budgets ?? settings.budgets,
  });
  return renderSnapshot(snapshot);
}
