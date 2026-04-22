/**
 * Skill file-writer — creates, updates, and deletes SKILL.md files.
 *
 * Write paths are filesystem-bound; in a read-only deployment (e.g. Vercel)
 * `rootIsWritable()` returns false and callers should disable edit/create.
 * The API route surfaces this as a 403.
 */

import fs from "node:fs";
import path from "node:path";
import { serializeFrontmatter } from "./frontmatter";
import { skillsRoot, loadSkill } from "./loader";
import type { Skill, SkillManifest } from "./schema";

const SLUG_RE = /^[a-z0-9][a-z0-9-_]*$/i;

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export interface CreateSkillInput {
  id?: string;
  manifest: SkillManifest;
  prompt: string;
}

export function createSkill(input: CreateSkillInput): Skill {
  const id = input.id ?? slugify(input.manifest.name);
  if (!id || !SLUG_RE.test(id)) {
    throw new Error(`invalid skill id: "${id}"`);
  }
  const folder = path.join(skillsRoot(), id);
  if (fs.existsSync(folder)) {
    throw new Error(`skill already exists: ${id}`);
  }
  fs.mkdirSync(folder, { recursive: true });
  writeSkillMd(folder, input.manifest, input.prompt);
  const skill = loadSkill(id);
  if (!skill) throw new Error(`created skill ${id} failed to reload`);
  return skill;
}

export interface UpdateSkillInput {
  id: string;
  manifest?: Partial<SkillManifest>;
  prompt?: string;
}

export function updateSkill(input: UpdateSkillInput): Skill {
  const existing = loadSkill(input.id);
  if (!existing) throw new Error(`skill not found: ${input.id}`);
  // Mutations only land back on the skill's originating folder. Imported
  // skills from another ecosystem stay editable if their folder is writable.
  const folder = existing.path;
  const nextManifest: SkillManifest = {
    id: existing.id,
    name: input.manifest?.name ?? existing.name,
    description: input.manifest?.description ?? existing.description,
    version: input.manifest?.version ?? existing.version,
    tags: input.manifest?.tags ?? existing.tags,
    tools: input.manifest?.tools ?? existing.tools,
    model: input.manifest?.model ?? existing.model,
    license: input.manifest?.license ?? existing.license,
    compatibility: input.manifest?.compatibility ?? existing.compatibility,
    metadata: input.manifest?.metadata ?? existing.metadata,
    systemPrompt: input.manifest?.systemPrompt,
  };
  const nextPrompt = input.prompt ?? existing.prompt;
  writeSkillMd(folder, nextManifest, nextPrompt);
  const reloaded = loadSkill(input.id);
  if (!reloaded) throw new Error(`updated skill ${input.id} failed to reload`);
  return reloaded;
}

export function deleteSkill(id: string): void {
  // Only deletes from the local writable root — imported skills from
  // another ecosystem's path are never touched by the API.
  const folder = path.join(skillsRoot(), id);
  if (!fs.existsSync(folder)) return;
  fs.rmSync(folder, { recursive: true, force: true });
}

function writeSkillMd(folder: string, manifest: SkillManifest, prompt: string): void {
  const front: Record<string, unknown> = {
    name: manifest.name,
    description: manifest.description,
    version: manifest.version,
    tags: manifest.tags,
    tools: manifest.tools,
  };
  if (manifest.model) front.model = manifest.model;
  if (manifest.license) front.license = manifest.license;
  if (manifest.compatibility) front.compatibility = manifest.compatibility;
  const content = serializeFrontmatter(front, `\n${prompt.trim()}\n`);
  fs.writeFileSync(path.join(folder, "SKILL.md"), content, "utf8");
}
