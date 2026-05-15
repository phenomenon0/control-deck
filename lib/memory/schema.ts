/**
 * Memory schema — two targets ("memory" and "user"), char-budgeted, entries
 * separated by the `§` glyph on its own line. Mirrors the Hermes built-in
 * memory contract so the same mental model applies.
 *
 * - target="memory" → agent notes: environment facts, conventions, lessons.
 * - target="user"   → user profile: prefs, communication style, routines.
 *
 * Budgets are intentionally small. They exist to keep the prompt prefix tight
 * and force the agent to curate, not log.
 */

import { z } from "zod";

export const MEMORY_TARGETS = ["memory", "user"] as const;
export type MemoryTarget = (typeof MEMORY_TARGETS)[number];

/** Character budgets, matching the Hermes defaults. Tweakable via settings. */
export const DEFAULT_MEMORY_BUDGETS: Record<MemoryTarget, number> = {
  memory: 2200,
  user: 1375,
};

/** On-disk filenames inside the profile memories root. */
export const MEMORY_FILENAMES: Record<MemoryTarget, string> = {
  memory: "MEMORY.md",
  user: "USER.md",
};

/** Block separator. A line containing exactly `§`, padded by blank lines. */
export const ENTRY_SEPARATOR = "\n\n§\n\n";
/** Regex form used when parsing — tolerates trailing whitespace. */
export const ENTRY_SEPARATOR_RE = /\n\s*§\s*\n/;

export const MemoryActionSchema = z.enum(["add", "replace", "remove"]);
export type MemoryAction = z.infer<typeof MemoryActionSchema>;

/**
 * Tool input shape — the `memory` MCP tool will pass through this schema.
 * `content` is required for add/replace; `old_text` is required for
 * replace/remove and is matched as a short unique substring.
 */
export const MemoryToolInputSchema = z
  .object({
    action: MemoryActionSchema,
    target: z.enum(MEMORY_TARGETS),
    content: z.string().optional(),
    old_text: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if ((val.action === "add" || val.action === "replace") && !val.content) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `action="${val.action}" requires content`,
        path: ["content"],
      });
    }
    if ((val.action === "replace" || val.action === "remove") && !val.old_text) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `action="${val.action}" requires old_text`,
        path: ["old_text"],
      });
    }
  });
export type MemoryToolInput = z.infer<typeof MemoryToolInputSchema>;

export interface MemoryEntry {
  /** Normalized text body of the entry. */
  text: string;
  /** sha256 of the normalized text — used for dedup. */
  hash: string;
}

export interface MemoryFileState {
  target: MemoryTarget;
  path: string;
  entries: MemoryEntry[];
  totalChars: number;
  budget: number;
}

export interface MemoryWriteResult {
  state: MemoryFileState;
  /** Non-fatal information for the caller — e.g. "duplicate skipped". */
  warning?: string;
}
