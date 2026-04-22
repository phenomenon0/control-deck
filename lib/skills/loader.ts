/**
 * Multi-source skill loader. Walks every enabled source from
 * `lib/skills/sources.ts`, parses SKILL.md frontmatter (cross-compatible
 * with Claude Code / OpenCode / Codex), and returns a deduplicated list.
 *
 * Dedup rule: **first source wins on id collision** — this matches how
 * Claude Code and OpenCode treat project skills as overriding user skills
 * when they share a name. Source ordering is set in `builtInSources()`.
 */

import fs from "node:fs";
import path from "node:path";
import { parseFrontmatter } from "./frontmatter";
import {
  CodexExtrasSchema,
  SkillManifestSchema,
  type CodexExtras,
  type Skill,
  type SkillSourceRef,
} from "./schema";
import { builtInSources, resolveSources, type SkillSource } from "./sources";
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
  const skillMdPath = path.join(folder, "SKILL.md");
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
    source: sourceRef(source),
    codex,
  };
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

export function loadSkills(): Skill[] {
  const seen = new Map<string, Skill>();
  for (const source of enabledSources()) {
    if (!source.exists) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(source.path, { withFileTypes: true });
    } catch (e) {
      console.warn(`[skills] can't list ${source.path}:`, e);
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || entry.name.startsWith("_")) continue;
      const folder = path.join(source.path, entry.name);
      const skill = loadSkillFolder(folder, source);
      if (!skill) continue;
      // Dedup: first source wins on id collision.
      if (!seen.has(skill.id)) seen.set(skill.id, skill);
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function loadSkill(id: string): Skill | null {
  // Same ordering as loadSkills — first hit wins.
  for (const source of enabledSources()) {
    if (!source.exists) continue;
    const folder = path.join(source.path, id);
    if (!fs.existsSync(path.join(folder, "SKILL.md"))) continue;
    const skill = loadSkillFolder(folder, source);
    if (skill) return skill;
  }
  return null;
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

