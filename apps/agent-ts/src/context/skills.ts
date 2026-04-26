/**
 * Skills runtime — Hermes-style progressive disclosure.
 *
 * Scans `<workspace>/skills/<category>/<name>/SKILL.md` (and the flatter
 * `<workspace>/skills/<name>/SKILL.md`). Each SKILL.md begins with a YAML
 * frontmatter block of the shape:
 *
 *   ---
 *   name: example
 *   description: One-line pitch shown to the agent.
 *   tags: [a, b]
 *   ---
 *   ...the rest is the body the agent loads on demand.
 *
 * We expose two tools:
 *   - skills_list  → returns name + description for every discovered skill
 *   - skill_view   → returns the full body of a named skill
 *
 * Listing is metadata-only so it stays cheap to keep in every prompt; the
 * full body is only pulled when the agent decides to read it.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { Type, type Static } from "typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";

import { WorkspaceJail } from "../tools/jail.js";

export interface SkillMeta {
  name: string;
  description: string;
  tags: string[];
  /** workspace-relative path to the SKILL.md */
  path: string;
}

export interface Skill extends SkillMeta {
  body: string;
}

const MAX_SKILL_BYTES = 64 * 1024;

export async function discoverSkills(jail: WorkspaceJail): Promise<SkillMeta[]> {
  let root: string;
  try {
    root = jail.resolve("skills");
  } catch {
    return [];
  }
  let entries: string[];
  try {
    entries = await collectSkillFiles(root);
  } catch {
    return [];
  }
  const out: SkillMeta[] = [];
  for (const abs of entries) {
    const meta = await readSkillMeta(jail, abs);
    if (meta) out.push(meta);
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

async function collectSkillFiles(root: string, depth = 0): Promise<string[]> {
  if (depth > 4) return [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    const full = path.join(root, e.name);
    if (e.isDirectory()) {
      out.push(...(await collectSkillFiles(full, depth + 1)));
    } else if (e.isFile() && e.name === "SKILL.md") {
      out.push(full);
    }
  }
  return out;
}

async function readSkillMeta(jail: WorkspaceJail, abs: string): Promise<SkillMeta | null> {
  let buf: Buffer;
  try {
    buf = await fs.readFile(abs);
  } catch {
    return null;
  }
  const { meta } = parseFrontmatter(buf.toString("utf8"));
  const fallbackName = path.basename(path.dirname(abs));
  const name = stringField(meta, "name") ?? fallbackName;
  const description = stringField(meta, "description") ?? "";
  const tags = stringListField(meta, "tags");
  return {
    name,
    description,
    tags,
    path: jail.toRelative(abs),
  };
}

export async function loadSkill(
  jail: WorkspaceJail,
  name: string,
): Promise<Skill | null> {
  const all = await discoverSkills(jail);
  const meta = all.find((s) => s.name === name);
  if (!meta) return null;
  let abs: string;
  try {
    abs = jail.resolve(meta.path);
  } catch {
    return null;
  }
  let buf: Buffer;
  try {
    buf = await fs.readFile(abs);
  } catch {
    return null;
  }
  if (buf.byteLength > MAX_SKILL_BYTES) {
    buf = buf.subarray(0, MAX_SKILL_BYTES);
  }
  const { body } = parseFrontmatter(buf.toString("utf8"));
  return { ...meta, body: body.trimEnd() };
}

type AnyTool = AgentTool<any, any>;

function textResult<T>(text: string, details: T): AgentToolResult<T> {
  return { content: [{ type: "text", text }], details };
}

export function skillsTools(jail: WorkspaceJail): AnyTool[] {
  return [skillsList(jail) as AnyTool, skillView(jail) as AnyTool];
}

function skillsList(jail: WorkspaceJail) {
  const params = Type.Object({});
  return {
    name: "skills_list",
    label: "List skills",
    description:
      "List the names and one-line descriptions of all SKILL.md files installed in the workspace. " +
      "Use skill_view to load the full body of a skill.",
    parameters: params,
    async execute(_id: string, _args: Static<typeof params>) {
      const skills = await discoverSkills(jail);
      if (skills.length === 0) {
        return textResult("No skills installed.", { skills: [] });
      }
      const lines = skills.map((s) =>
        s.description ? `- ${s.name}: ${s.description}` : `- ${s.name}`,
      );
      return textResult(lines.join("\n"), { skills });
    },
  };
}

function skillView(jail: WorkspaceJail) {
  const params = Type.Object({
    name: Type.String({ description: "Skill name as listed by skills_list." }),
  });
  return {
    name: "skill_view",
    label: "View skill",
    description: "Return the full SKILL.md body for a named skill.",
    parameters: params,
    async execute(_id: string, args: Static<typeof params>) {
      const skill = await loadSkill(jail, args.name);
      if (!skill) {
        return textResult(`Skill not found: ${args.name}`, { found: false });
      }
      return textResult(skill.body, {
        found: true,
        name: skill.name,
        description: skill.description,
        tags: skill.tags,
        path: skill.path,
      });
    },
  };
}

/**
 * Tiny YAML-frontmatter splitter. Returns the raw key→value map and the body
 * after the closing `---`. Only handles flat scalars, single-line `[a, b]`
 * lists, and `# comment` lines — that's all SKILL.md files use in practice.
 */
function parseFrontmatter(text: string): { meta: Record<string, unknown>; body: string } {
  if (!text.startsWith("---")) return { meta: {}, body: text };
  const lines = text.split(/\r?\n/);
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) return { meta: {}, body: text };
  const meta: Record<string, unknown> = {};
  for (let i = 1; i < end; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(trimmed);
    if (!m) continue;
    const key = m[1];
    const val = m[2].trim();
    meta[key] = val.length === 0 ? "" : parseScalar(val);
  }
  const body = lines.slice(end + 1).join("\n");
  return { meta, body };
}

function parseScalar(v: string): unknown {
  if (v.startsWith("[") && v.endsWith("]")) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((s) => stripQuotes(s.trim()));
  }
  return stripQuotes(v);
}

function stripQuotes(v: string): string {
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1);
  }
  return v;
}

function stringField(meta: Record<string, unknown>, key: string): string | undefined {
  const v = meta[key];
  return typeof v === "string" && v.length ? v : undefined;
}

function stringListField(meta: Record<string, unknown>, key: string): string[] {
  const v = meta[key];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string" && v.length) return [v];
  return [];
}
