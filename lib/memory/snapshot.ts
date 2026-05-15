/**
 * Frozen prompt snapshot — read MEMORY.md and USER.md once per session,
 * dedupe, enforce char budgets defensively, and return the two markdown
 * blocks the system prompt should inject.
 *
 * Why frozen: the prompt prefix has to stay byte-stable for KV cache hits
 * across turns. If the agent writes new memory mid-session the file does
 * change immediately on disk, but the snapshot returned here is what the
 * model sees until the next session reads.
 *
 * Seeding: if no profile file exists yet, fall back to the repo-root
 * MEMORY.md / USER.md so the very first session still has the curated
 * defaults. Once any write lands in the profile, the profile file wins.
 */

import fs from "node:fs";
import path from "node:path";

import {
  DEFAULT_MEMORY_BUDGETS,
  ENTRY_SEPARATOR,
  ENTRY_SEPARATOR_RE,
  MEMORY_FILENAMES,
  MEMORY_TARGETS,
  type MemoryTarget,
} from "./schema";
import { memoriesRoot, type MemoryRootOpts } from "./store";

export interface MemorySnapshotBlock {
  target: MemoryTarget;
  /** Rendered text, ready to splice into the system prompt (or "" if empty). */
  text: string;
  /** Where the content came from. */
  source: "profile" | "repo-seed" | "empty";
  /** Absolute path of the file the content was read from, if any. */
  sourcePath: string | null;
  /** Total character count of `text`. */
  chars: number;
  /** Budget applied — `text.length <= budget`. */
  budget: number;
  /** Number of entries (post-dedup). */
  entryCount: number;
}

export interface MemorySnapshot {
  memory: MemorySnapshotBlock;
  user: MemorySnapshotBlock;
}

export interface SnapshotOpts extends MemoryRootOpts {
  /** Override the repo-root fallback. Tests pass a fixture dir. */
  repoRoot?: string;
  /** Per-target budgets if the caller needs to override the defaults. */
  budgets?: Partial<Record<MemoryTarget, number>>;
}

function safeReadFile(p: string): string | null {
  try {
    const stat = fs.statSync(p);
    if (!stat.isFile()) return null;
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

/**
 * Strip a leading frontmatter `---` block and split into entries.
 *
 * Profile files are owned by the memory store and always use the `§`
 * separator — single-entry files just contain one block with no separator.
 * Repo-seed files are human-written markdown; we pull bullet items and
 * drop everything else (headings, intros, "What To Store" sections).
 *
 * This is a one-way read; we never write back into the repo-root files.
 */
function extractEntries(raw: string, source: "profile" | "repo-seed"): string[] {
  const stripped = raw.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
  if (!stripped) return [];

  if (source === "profile") {
    return stripped
      .split(ENTRY_SEPARATOR_RE)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // repo-seed — bullet items only.
  const bullets: string[] = [];
  for (const line of stripped.split(/\r?\n/)) {
    const m = /^\s*[-*]\s+(.+?)\s*$/.exec(line);
    if (m) bullets.push(m[1]);
  }
  return bullets;
}

function dedupe(entries: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of entries) {
    const key = e.trim().toLowerCase().replace(/\s+/g, " ");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(e.trim());
  }
  return out;
}

function applyBudget(entries: string[], budget: number): string[] {
  if (entries.length === 0) return entries;
  // Trim oldest first if we're over budget.
  const out = entries.slice();
  while (out.length > 0 && out.join(ENTRY_SEPARATOR).length > budget) {
    out.shift();
  }
  return out;
}

function renderBlock(target: MemoryTarget, entries: string[]): string {
  if (entries.length === 0) return "";
  const heading =
    target === "memory"
      ? "# MEMORY (your personal notes)"
      : "# USER PROFILE (who the user is)";
  return `${heading}\n\n${entries.join(ENTRY_SEPARATOR)}\n`;
}

function loadBlock(target: MemoryTarget, opts: SnapshotOpts): MemorySnapshotBlock {
  const budget = opts.budgets?.[target] ?? DEFAULT_MEMORY_BUDGETS[target];
  const filename = MEMORY_FILENAMES[target];
  const profilePath = path.join(memoriesRoot(opts), filename);
  const repoPath = path.join(opts.repoRoot ?? process.cwd(), filename);

  let source: MemorySnapshotBlock["source"] = "empty";
  let sourcePath: string | null = null;
  let raw: string | null = safeReadFile(profilePath);
  if (raw !== null) {
    source = "profile";
    sourcePath = profilePath;
  } else {
    raw = safeReadFile(repoPath);
    if (raw !== null) {
      source = "repo-seed";
      sourcePath = repoPath;
    }
  }

  const entries =
    raw !== null && source !== "empty"
      ? applyBudget(dedupe(extractEntries(raw, source)), budget)
      : [];
  const text = renderBlock(target, entries);
  return {
    target,
    text,
    source,
    sourcePath,
    chars: text.length,
    budget,
    entryCount: entries.length,
  };
}

/**
 * Take a snapshot of both memory files for this session. Pure read — never
 * writes. Call this once at prompt-assembly time and cache the result for
 * the session if you want to mirror Hermes' frozen-snapshot semantics.
 */
export function loadMemorySnapshot(opts: SnapshotOpts = {}): MemorySnapshot {
  const [memory, user] = MEMORY_TARGETS.map((t) => loadBlock(t, opts)) as [
    MemorySnapshotBlock,
    MemorySnapshotBlock,
  ];
  return { memory, user };
}

/**
 * Render the snapshot down to a single string for splicing into the
 * system prompt. Empty blocks are omitted entirely so the prompt stays
 * tight when memory is unused.
 */
export function renderSnapshot(snapshot: MemorySnapshot): string {
  return [snapshot.memory.text, snapshot.user.text].filter(Boolean).join("\n");
}
