/**
 * Rule-file scanner. Walks the standard locations across ecosystems and
 * returns a flat list of RuleFile records.
 *
 * Strategy: one scan pass per ecosystem convention, results merged and
 * deduplicated by absolute path. Parent-directory walks cap at 5 levels so
 * we don't read a user's entire home tree. Each file is size-gated (max
 * 512 KB — way above any legitimate rules file and far below the point
 * where reading costs anything).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import type { RuleFile, RuleKind, RuleScope } from "./schema";

const MAX_SIZE_BYTES = 512 * 1024;
const MAX_PARENT_WALK = 5;
const PREVIEW_CHARS = 220;

function projectRoot(): string {
  return process.env.DECK_PROJECT_ROOT ?? process.cwd();
}

function readPreview(abs: string): { preview: string; lineCount: number } {
  try {
    const text = fs.readFileSync(abs, "utf8");
    const oneLine = text
      .replace(/\r?\n+/g, " ")
      .replace(/^\s*#+\s*/, "")
      .replace(/\s+/g, " ")
      .trim();
    return {
      preview: oneLine.slice(0, PREVIEW_CHARS) + (oneLine.length > PREVIEW_CHARS ? "…" : ""),
      lineCount: text.split(/\r?\n/).length,
    };
  } catch {
    return { preview: "", lineCount: 0 };
  }
}

function originFor(kind: RuleKind): string {
  switch (kind) {
    case "claude-md":
    case "claude-local":
    case "claude-user":
      return "Anthropic";
    case "agents-md":
    case "agents-override":
    case "agents-user":
      return "OpenAI Codex / OpenCode";
    case "cursor-legacy":
    case "cursor-rule":
      return "Cursor";
    case "windsurf":
      return "Windsurf";
    case "aider-conventions":
      return "Aider";
    case "continue":
      return "Continue";
    case "opencode-config":
      return "OpenCode";
  }
}

function makeRule(abs: string, kind: RuleKind, scope: RuleScope, rootForRel: string): RuleFile | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  if (stat.size > MAX_SIZE_BYTES) return null;
  const { preview, lineCount } = readPreview(abs);
  const id = crypto.createHash("sha256").update(abs).digest("hex").slice(0, 16);
  const dir = path.dirname(abs);
  const relativeDir = path.relative(rootForRel, dir) || ".";
  return {
    id,
    kind,
    scope,
    origin: originFor(kind),
    path: abs,
    filename: path.basename(abs),
    relativeDir,
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    preview,
    lineCount,
  };
}

function collectExact(
  dir: string,
  filenames: Array<{ name: string; kind: RuleKind }>,
  scope: RuleScope,
  rel: string,
): RuleFile[] {
  const out: RuleFile[] = [];
  for (const f of filenames) {
    const abs = path.join(dir, f.name);
    const r = makeRule(abs, f.kind, scope, rel);
    if (r) out.push(r);
  }
  return out;
}

function collectCursorModular(dir: string, scope: RuleScope, rel: string): RuleFile[] {
  const out: RuleFile[] = [];
  const rulesDir = path.join(dir, ".cursor", "rules");
  if (!fs.existsSync(rulesDir)) return out;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(rulesDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!e.name.endsWith(".mdc") && !e.name.endsWith(".md")) continue;
    const r = makeRule(path.join(rulesDir, e.name), "cursor-rule", scope, rel);
    if (r) out.push(r);
  }
  return out;
}

/**
 * The per-directory filename list for each ecosystem convention.
 */
const PROJECT_FILES: Array<{ name: string; kind: RuleKind }> = [
  { name: "CLAUDE.md", kind: "claude-md" },
  { name: "CLAUDE.local.md", kind: "claude-local" },
  { name: "AGENTS.md", kind: "agents-md" },
  { name: "AGENTS.override.md", kind: "agents-override" },
  { name: ".cursorrules", kind: "cursor-legacy" },
  { name: ".windsurfrules", kind: "windsurf" },
  { name: ".continuerules", kind: "continue" },
  { name: "CONVENTIONS.md", kind: "aider-conventions" },
  { name: "opencode.json", kind: "opencode-config" },
  { name: "opencode.jsonc", kind: "opencode-config" },
];

/**
 * Optional: comma-separated extra roots whose immediate-child directories
 * are also scanned for rules files. Useful for agentic workbenches where
 * you keep many sibling repos under one parent (e.g.
 * `DECK_RULES_SEARCH=/Users/me/dev` lights up every repo's CLAUDE.md /
 * AGENTS.md in one pane). Depth is capped at 2 to avoid scanning
 * node_modules and the like.
 */
function extraSearchRoots(): string[] {
  // Two sources unioned: DECK_RULES_SEARCH env var + settings.storage.rulesSearchRoots.
  // Either may be empty. Env wins on duplicate because it's explicit.
  const envRaw = process.env.DECK_RULES_SEARCH;
  const fromEnv = envRaw
    ? envRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  let fromSettings: string[] = [];
  try {
    // Lazy import so the scanner stays usable from tests that stub the DB.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { resolveSection } = require("@/lib/settings/resolve") as typeof import("@/lib/settings/resolve");
    const storage = resolveSection("storage");
    fromSettings = storage.rulesSearchRoots ?? [];
  } catch {
    // Settings unreachable (e.g. test env) — just use env.
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of [...fromEnv, ...fromSettings]) {
    const expanded = r.startsWith("~") ? r.replace("~", process.env.HOME ?? "~") : r;
    if (seen.has(expanded)) continue;
    seen.add(expanded);
    out.push(expanded);
  }
  return out;
}

const SEARCH_IGNORE = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  ".cache",
  "dist",
  "build",
  "target",
  "venv",
  ".venv",
  "__pycache__",
]);

function collectAt(dir: string, scope: RuleScope, rel: string): RuleFile[] {
  return [
    ...collectExact(dir, PROJECT_FILES, scope, rel),
    ...collectCursorModular(dir, scope, rel),
  ];
}

function walkSearchRoot(root: string, out: RuleFile[]) {
  if (!fs.existsSync(root)) return;
  // Depth 0 (root itself).
  out.push(...collectAt(root, "parent", root));
  // Depth 1 (immediate children).
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith(".") || SEARCH_IGNORE.has(e.name)) continue;
    const child = path.join(root, e.name);
    out.push(...collectAt(child, "parent", root));
  }
}

export function scanRules(): RuleFile[] {
  const root = projectRoot();
  const home = os.homedir();
  const seen = new Map<string, RuleFile>();
  const push = (r: RuleFile) => {
    if (!seen.has(r.path)) seen.set(r.path, r);
  };

  // Project root.
  for (const r of collectAt(root, "project", root)) push(r);

  // Walk up to 5 ancestor dirs — Codex's AGENTS.md discovery spec.
  let dir = root;
  for (let i = 0; i < MAX_PARENT_WALK; i++) {
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
    for (const r of collectAt(dir, "parent", root)) push(r);
  }

  // Extra search roots (sibling-scan mode).
  const collected: RuleFile[] = [];
  for (const extra of extraSearchRoots()) {
    walkSearchRoot(extra, collected);
  }
  for (const r of collected) push(r);

  // User home.
  const userFiles: Array<{ abs: string; kind: RuleKind }> = [
    { abs: path.join(home, ".claude", "CLAUDE.md"), kind: "claude-user" },
    { abs: path.join(home, ".codex", "AGENTS.md"), kind: "agents-user" },
    { abs: path.join(home, ".codex", "AGENTS.override.md"), kind: "agents-override" },
  ];
  for (const u of userFiles) {
    const r = makeRule(u.abs, u.kind, "user", home);
    if (r) push(r);
  }

  return [...seen.values()].sort((a, b) => {
    // Project scope first, then parent, user, system.
    const scopeOrder: Record<RuleScope, number> = {
      project: 0,
      parent: 1,
      user: 2,
      system: 3,
    };
    const s = scopeOrder[a.scope] - scopeOrder[b.scope];
    if (s !== 0) return s;
    return a.path.localeCompare(b.path);
  });
}

export function readRuleContent(
  absPath: string,
): { content: string; truncated: boolean; writable: boolean } | null {
  try {
    const stat = fs.statSync(absPath);
    if (!stat.isFile()) return null;
    let writable = false;
    try {
      fs.accessSync(absPath, fs.constants.W_OK);
      writable = true;
    } catch {
      /* read-only */
    }
    if (stat.size > MAX_SIZE_BYTES) {
      const fd = fs.openSync(absPath, "r");
      const buf = Buffer.alloc(MAX_SIZE_BYTES);
      fs.readSync(fd, buf, 0, MAX_SIZE_BYTES, 0);
      fs.closeSync(fd);
      return { content: buf.toString("utf8"), truncated: true, writable: false };
    }
    return { content: fs.readFileSync(absPath, "utf8"), truncated: false, writable };
  } catch {
    return null;
  }
}

/**
 * Write a rule file back to disk.
 *
 * Safety: only writes if the file already exists (no create-from-scratch),
 * is NOT under /etc or a system scope, and is writable. Anything else
 * throws — the API handler turns exceptions into 403.
 */
export function writeRuleContent(absPath: string, content: string): void {
  if (!fs.existsSync(absPath)) {
    throw new Error("rule file does not exist");
  }
  const stat = fs.statSync(absPath);
  if (!stat.isFile()) throw new Error("target is not a file");

  // Refuse anything under /etc or /usr — system locations are off-limits.
  if (absPath.startsWith("/etc/") || absPath.startsWith("/usr/")) {
    throw new Error("system-path rules are read-only");
  }

  try {
    fs.accessSync(absPath, fs.constants.W_OK);
  } catch {
    throw new Error("file is not writable by this process");
  }

  if (Buffer.byteLength(content, "utf8") > MAX_SIZE_BYTES) {
    throw new Error("content exceeds 512 KB limit");
  }

  fs.writeFileSync(absPath, content, "utf8");
}
