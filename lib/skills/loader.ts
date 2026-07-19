/**
 * Multi-source skill loader — the deck's filesystem index over the SAME
 * SKILL.md files agent-ts exposes as native tools (canon, thread T9: the
 * filesystem is the store; the DB registry is gone). Walks every enabled
 * source from `lib/skills/sources.ts`, parses SKILL.md frontmatter
 * (cross-compatible with Claude Code / OpenCode / Codex), and returns a
 * deduplicated list with the settings enabled-overlay applied.
 *
 * Scan parity with agent-ts (`apps/agent-ts/src/context/skills.ts`): the
 * walk recurses into category folders up to SKILL_SCAN_MAX_DEPTH levels
 * (see ./roots.ts — the shared layout contract; agent-ts keeps its own
 * copy). A skill is any directory containing SKILL.md; dot/underscore
 * folders are skipped.
 *
 * Dedup rule: **first source wins on id collision** — this matches how
 * Claude Code and OpenCode treat project skills as overriding user skills
 * when they share a name. Source ordering is set in `builtInSources()`.
 *
 * `scanSkills`/`scanSkill` take explicit sources + overrides so tests can
 * run against fixture directories without touching settings or the DB;
 * the exported `loadSkills`/`loadSkill` wire in live settings.
 */

import fs from "node:fs";
import path from "node:path";
import { parseFrontmatter } from "./frontmatter";
import { SKILL_FILE_NAME, SKILL_SCAN_MAX_DEPTH } from "./roots";
import {
  CodexExtrasSchema,
  SkillManifestSchema,
  type CodexExtras,
  type Skill,
  type SkillSourceRef,
} from "./schema";
import { builtInSources, resolveSources, type SkillSource } from "./sources";
import { readSkillOverrides, type SkillOverrides } from "./enabled";
import { resolveSection } from "@/lib/settings/resolve";
import type { SkillSourcesSettings } from "@/lib/settings/schema";

function isWritable(dirPath: string): boolean {
  try {
    fs.accessSync(dirPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function sourceRef(s: SkillSource): SkillSourceRef {
  return {
    id: s.id,
    kind: s.kind,
    scope: s.scope,
    label: s.label,
    origin: s.origin,
    path: s.path,
  };
}

function loadCodexExtras(folder: string): CodexExtras | undefined {
  const yamlPath = path.join(folder, "agents", "openai.yaml");
  if (!fs.existsSync(yamlPath)) return undefined;
  try {
    const raw = fs.readFileSync(yamlPath, "utf8");
    const data = parseFrontmatter(`---\n${raw}\n---\n`).data;
    const parsed = CodexExtrasSchema.safeParse(data);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function loadSkillFolder(folder: string, source: SkillSource): Skill | null {
  const skillMdPath = path.join(folder, SKILL_FILE_NAME);
  if (!fs.existsSync(skillMdPath)) return null;

  const folderId = path.basename(folder);
  let frontmatter: Record<string, unknown> = {};
  let body = "";
  try {
    const text = fs.readFileSync(skillMdPath, "utf8");
    const parsed = parseFrontmatter(text);
    frontmatter = parsed.data;
    body = parsed.body;
  } catch (e) {
    console.warn(`[skills] failed to read ${skillMdPath}:`, e);
    return null;
  }

  // Optional manifest.json layers over frontmatter.
  const manifestPath = path.join(folder, "manifest.json");
  let overlay: Record<string, unknown> = {};
  if (fs.existsSync(manifestPath)) {
    try {
      overlay = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
      console.warn(`[skills] ${manifestPath} is not valid JSON; ignoring`);
    }
  }

  const merged: Record<string, unknown> = { ...frontmatter, ...overlay };
  if (!merged.id) merged.id = folderId;

  const parsedManifest = SkillManifestSchema.safeParse(merged);
  if (!parsedManifest.success) {
    console.warn(
      `[skills] ${folderId} (${source.id}) manifest failed validation; skipping:`,
      parsedManifest.error.issues,
    );
    return null;
  }
  const manifest = parsedManifest.data;

  const prompt = manifest.systemPrompt ?? body.trim();
  const codex = loadCodexExtras(folder);

  return {
    id: manifest.id ?? folderId,
    name: manifest.name,
    description: manifest.description,
    version: manifest.version,
    tags: manifest.tags,
    tools: manifest.tools,
    model: manifest.model,
    license: manifest.license,
    compatibility: manifest.compatibility,
    metadata: manifest.metadata,
    prompt,
    path: folder,
    writable: isWritable(folder),
    // Real state comes from the settings overlay — scanSkills applies it.
    enabled: true,
    source: sourceRef(source),
    codex,
  };
}

/**
 * Recursively collect every directory holding a SKILL.md, up to
 * SKILL_SCAN_MAX_DEPTH levels below `root` (depth 0 = root). Mirrors
 * agent-ts's `collectSkillFiles`; dot/underscore folders are pruned.
 * Parents list before their children.
 */
export function collectSkillFolders(root: string, depth = 0): string[] {
  if (depth > SKILL_SCAN_MAX_DEPTH) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  let hasSkillMd = false;
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".") || entry.name.startsWith("_")) continue;
      out.push(...collectSkillFolders(path.join(root, entry.name), depth + 1));
    } else if (entry.isFile() && entry.name === SKILL_FILE_NAME) {
      hasSkillMd = true;
    }
  }
  if (hasSkillMd) out.unshift(root);
  return out;
}

function readSourceSettings(): SkillSourcesSettings {
  try {
    return resolveSection("sources");
  } catch {
    return { overrides: {}, custom: [] };
  }
}

export function enabledSources(): SkillSource[] {
  const s = readSourceSettings();
  return resolveSources(s.overrides, s.custom).filter((src) => src.enabled);
}

/** All sources including disabled ones — for the Sources panel UI. */
export function allSources(): SkillSource[] {
  const s = readSourceSettings();
  return resolveSources(s.overrides, s.custom);
}

function withEnabled(skill: Skill, overrides: SkillOverrides): Skill {
  return { ...skill, enabled: overrides[skill.path]?.enabled ?? true };
}

/**
 * Pure scan over explicit sources with an explicit enabled-overlay — the
 * testable seam behind `loadSkills`. First source wins on id collision.
 */
export function scanSkills(sources: SkillSource[], overrides: SkillOverrides = {}): Skill[] {
  const seen = new Map<string, Skill>();
  for (const source of sources) {
    if (!source.enabled || !source.exists) continue;
    for (const folder of collectSkillFolders(source.path)) {
      const skill = loadSkillFolder(folder, source);
      if (!skill) continue;
      // Dedup: first source wins on id collision.
      if (!seen.has(skill.id)) seen.set(skill.id, withEnabled(skill, overrides));
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Pure single-skill lookup behind `loadSkill` — same ordering as scanSkills. */
export function scanSkill(
  id: string,
  sources: SkillSource[],
  overrides: SkillOverrides = {},
): Skill | null {
  for (const source of sources) {
    if (!source.enabled || !source.exists) continue;
    for (const folder of collectSkillFolders(source.path)) {
      const skill = loadSkillFolder(folder, source);
      if (skill && skill.id === id) return withEnabled(skill, overrides);
    }
  }
  return null;
}

export function loadSkills(): Skill[] {
  return scanSkills(enabledSources(), readSkillOverrides());
}

export function loadSkill(id: string): Skill | null {
  return scanSkill(id, enabledSources(), readSkillOverrides());
}

/**
 * Writable root for new skills. Prefers the local app `skills/` dir because
 * it's always writable and under version control; users can later override
 * with DECK_SKILLS_DIR.
 */
export function writableRoot(): string {
  const local = builtInSources().find((s) => s.id === "local");
  if (!local) throw new Error("local source missing");
  try {
    fs.mkdirSync(local.path, { recursive: true });
  } catch {
    /* ignore */
  }
  return local.path;
}

export function rootIsWritable(): boolean {
  const root = writableRoot();
  return isWritable(root);
}

/** Back-compat alias. */
export function skillsRoot(): string {
  return writableRoot();
}
