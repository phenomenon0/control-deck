/**
 * Memory store — read/write the two curated memory files with safety,
 * dedup, char budgets, lockfile, and atomic temp-file replacement.
 *
 * Layout on disk:
 *
 *   <memoriesRoot>/
 *     MEMORY.md     agent notes
 *     USER.md       user profile
 *     .lock         exclusive lockfile (transient)
 *
 * Reads are cheap and lock-free. Writes acquire `.lock` first (O_EXCL with
 * a short retry loop), serialize the full file to a sibling `.tmp.<pid>`,
 * `fs.renameSync` it into place — atomic on POSIX — and release the lock.
 *
 * Entries are separated by `§` on its own line so the file stays valid
 * markdown and a human can edit it without confusing the parser.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { dataRoot } from "@/lib/storage/paths";
import { checkMemoryEntry, normalizeForDedup } from "./safety";
import {
  DEFAULT_MEMORY_BUDGETS,
  ENTRY_SEPARATOR,
  ENTRY_SEPARATOR_RE,
  MEMORY_FILENAMES,
  type MemoryEntry,
  type MemoryFileState,
  type MemoryTarget,
  type MemoryWriteResult,
} from "./schema";

const LOCK_RETRY_DELAY_MS = 25;
const LOCK_MAX_WAIT_MS = 1500;
const LOCK_STALE_MS = 30_000;

export interface MemoryRootOpts {
  /** Override for tests + non-default deployments. Wins over env + default. */
  root?: string;
}

/**
 * Resolve the directory that holds MEMORY.md / USER.md. Default is
 * `<dataRoot>/memories`, override with `CONTROL_DECK_MEMORIES_DIR`. Tests
 * pass `root` directly to avoid touching env state.
 */
export function memoriesRoot(opts: MemoryRootOpts = {}): string {
  if (opts.root) return path.resolve(opts.root);
  if (process.env.CONTROL_DECK_MEMORIES_DIR) {
    return path.resolve(process.env.CONTROL_DECK_MEMORIES_DIR);
  }
  return path.join(dataRoot(), "memories");
}

export function memoryFilePath(target: MemoryTarget, opts: MemoryRootOpts = {}): string {
  return path.join(memoriesRoot(opts), MEMORY_FILENAMES[target]);
}

function hashEntry(text: string): string {
  return crypto.createHash("sha256").update(normalizeForDedup(text)).digest("hex").slice(0, 16);
}

function makeEntry(text: string): MemoryEntry {
  const trimmed = text.trim();
  return { text: trimmed, hash: hashEntry(trimmed) };
}

function parseEntries(content: string): MemoryEntry[] {
  const stripped = content.replace(/^---\n[\s\S]*?\n---\n/, "");
  return stripped
    .split(ENTRY_SEPARATOR_RE)
    .map((b) => b.trim())
    .filter(Boolean)
    .map(makeEntry);
}

function serializeEntries(entries: MemoryEntry[]): string {
  if (entries.length === 0) return "";
  return entries.map((e) => e.text).join(ENTRY_SEPARATOR) + "\n";
}

function totalChars(entries: MemoryEntry[]): number {
  // Count the on-disk size we'd produce; matches what the snapshot injects.
  return serializeEntries(entries).length;
}

/** Read the file into a state struct. Missing file → empty state. */
export function readMemoryFile(target: MemoryTarget, opts: MemoryRootOpts = {}): MemoryFileState {
  const filePath = memoryFilePath(target, opts);
  const budget = DEFAULT_MEMORY_BUDGETS[target];
  let entries: MemoryEntry[] = [];
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    entries = parseEntries(raw);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  return {
    target,
    path: filePath,
    entries,
    totalChars: totalChars(entries),
    budget,
  };
}

function lockPath(root: string): string {
  return path.join(root, ".lock");
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function acquireLock(root: string): Promise<number> {
  fs.mkdirSync(root, { recursive: true });
  const lp = lockPath(root);
  const started = Date.now();
  while (true) {
    try {
      const fd = fs.openSync(lp, "wx");
      fs.writeSync(fd, `${process.pid}\n${Date.now()}\n`);
      return fd;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      // Steal stale locks rather than wedging forever on a crash.
      try {
        const stat = fs.statSync(lp);
        if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
          fs.rmSync(lp, { force: true });
          continue;
        }
      } catch {
        /* race — loop */
      }
      if (Date.now() - started > LOCK_MAX_WAIT_MS) {
        throw new Error(`memory lock timeout after ${LOCK_MAX_WAIT_MS}ms`);
      }
      await sleep(LOCK_RETRY_DELAY_MS);
    }
  }
}

function releaseLock(root: string, fd: number): void {
  try {
    fs.closeSync(fd);
  } catch {
    /* already closed */
  }
  fs.rmSync(lockPath(root), { force: true });
}

/**
 * Atomically write `content` to `filePath`. Goes through `<filePath>.tmp.<pid>`
 * + `rename` so a partially-written file never becomes visible to readers.
 */
function atomicWrite(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}.${crypto.randomBytes(4).toString("hex")}`;
  fs.writeFileSync(tmp, content, "utf8");
  try {
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best-effort */ }
    throw err;
  }
}

async function withLock<T>(root: string, fn: () => T): Promise<T> {
  const fd = await acquireLock(root);
  try {
    return fn();
  } finally {
    releaseLock(root, fd);
  }
}

/** Find the entry whose text contains `needle`. Requires a unique match. */
function findUnique(entries: MemoryEntry[], needle: string): { index: number; matches: number } {
  const n = needle.trim();
  if (!n) return { index: -1, matches: 0 };
  let index = -1;
  let matches = 0;
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].text.includes(n)) {
      matches++;
      if (matches === 1) index = i;
    }
  }
  return { index, matches };
}

export interface AddOptions extends MemoryRootOpts {
  /** Override the default budget for this write only. */
  budget?: number;
}

/**
 * Append a new entry. Rejects if:
 *   - safety check fails (injection / exfil / control chars)
 *   - dedup hash already present (returns ok with `warning: "duplicate"`)
 *   - would exceed the char budget
 */
export async function addEntry(
  target: MemoryTarget,
  content: string,
  opts: AddOptions = {},
): Promise<MemoryWriteResult> {
  const safety = checkMemoryEntry(content);
  if (!safety.ok) throw new Error(`safety rejected entry: ${safety.reason}`);

  const root = memoriesRoot(opts);
  return withLock(root, () => {
    const state = readMemoryFile(target, opts);
    const budget = opts.budget ?? state.budget;
    const candidate = makeEntry(safety.cleaned);

    if (state.entries.some((e) => e.hash === candidate.hash)) {
      return { state, warning: "duplicate entry skipped" };
    }

    const next = [...state.entries, candidate];
    const nextSize = totalChars(next);
    if (nextSize > budget) {
      throw new Error(
        `budget exceeded: would write ${nextSize} chars, budget is ${budget} (target=${target})`,
      );
    }

    atomicWrite(state.path, serializeEntries(next));
    return {
      state: { ...state, entries: next, totalChars: nextSize, budget },
    };
  });
}

/**
 * Replace the entry containing `oldText` (short unique substring) with
 * `content`. `oldText` must match exactly one entry; zero or multiple
 * matches throw.
 */
export async function replaceEntry(
  target: MemoryTarget,
  oldText: string,
  content: string,
  opts: AddOptions = {},
): Promise<MemoryWriteResult> {
  const safety = checkMemoryEntry(content);
  if (!safety.ok) throw new Error(`safety rejected entry: ${safety.reason}`);

  const root = memoriesRoot(opts);
  return withLock(root, () => {
    const state = readMemoryFile(target, opts);
    const budget = opts.budget ?? state.budget;
    const { index, matches } = findUnique(state.entries, oldText);
    if (matches === 0) throw new Error(`replace: no entry matched old_text`);
    if (matches > 1) throw new Error(`replace: old_text matched ${matches} entries; needs to be unique`);

    const replacement = makeEntry(safety.cleaned);

    // If replacement collides with another (non-target) entry, drop the dup.
    const collides = state.entries.findIndex(
      (e, i) => i !== index && e.hash === replacement.hash,
    );
    let next = state.entries.slice();
    next[index] = replacement;
    if (collides !== -1) {
      next = next.filter((_, i) => i !== collides);
    }

    const nextSize = totalChars(next);
    if (nextSize > budget) {
      throw new Error(
        `budget exceeded: would write ${nextSize} chars, budget is ${budget} (target=${target})`,
      );
    }

    atomicWrite(state.path, serializeEntries(next));
    return {
      state: { ...state, entries: next, totalChars: nextSize, budget },
    };
  });
}

/**
 * Remove the entry containing `oldText`. Same uniqueness rule as replace.
 */
export async function removeEntry(
  target: MemoryTarget,
  oldText: string,
  opts: MemoryRootOpts = {},
): Promise<MemoryWriteResult> {
  const root = memoriesRoot(opts);
  return withLock(root, () => {
    const state = readMemoryFile(target, opts);
    const { index, matches } = findUnique(state.entries, oldText);
    if (matches === 0) throw new Error(`remove: no entry matched old_text`);
    if (matches > 1) throw new Error(`remove: old_text matched ${matches} entries; needs to be unique`);

    const next = state.entries.filter((_, i) => i !== index);
    atomicWrite(state.path, serializeEntries(next));
    return {
      state: { ...state, entries: next, totalChars: totalChars(next), budget: state.budget },
    };
  });
}

/** Convenience for tests + tools: ensure the memories dir exists. */
export function ensureMemoriesRoot(opts: MemoryRootOpts = {}): string {
  const root = memoriesRoot(opts);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

/** Used by snapshot.ts when no profile file exists yet; safe-to-export. */
export function tempScratchRoot(label = "control-deck-memory"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`));
}
