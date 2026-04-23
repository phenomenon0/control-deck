/**
 * Skill schema — cross-compatible with Claude Code, OpenCode, and Codex.
 *
 * All three ecosystems converge on `SKILL.md` with YAML frontmatter carrying
 * at least `name` and `description`. OpenCode adds `license`, `compatibility`,
 * and a free-form `metadata` map. Codex adds an optional `agents/openai.yaml`
 * sibling with UI + tool-dependency declarations.
 *
 * We parse a superset so one skill folder authored for any ecosystem works
 * here, and skills authored here stay portable to all three.
 *
 * Folder layout:
 *
 *   <skill-id>/
 *     SKILL.md             (required)
 *     manifest.json        (optional Control-Deck extras — tools whitelist)
 *     agents/openai.yaml   (optional — Codex UI + tool deps)
 *     scripts/ references/ assets/   (optional)
 */

import { z } from "zod";

/** Raw frontmatter accepted from SKILL.md (superset of all three formats). */
export const SkillManifestSchema = z.object({
  /** Stable slug. Derived from folder name if absent. */
  id: z.string().min(1).optional(),
  /** Human-readable title. */
  name: z.string().min(1),
  description: z.string().min(1),
  version: z.string().default("0.1.0"),
  tags: z.array(z.string()).default([]),
  /** Tool names the skill is allowed to call. Empty = no tools. */
  tools: z.array(z.string()).default([]),
  /** Optional model pin. */
  model: z.string().optional(),
  /** OpenCode extension: license identifier (SPDX). */
  license: z.string().optional(),
  /** OpenCode extension: compatibility hint — e.g. "claude-code,opencode". */
  compatibility: z.string().optional(),
  /** OpenCode extension: free-form string metadata map. */
  metadata: z.record(z.string(), z.string()).default({}),
  /** Non-standard override — carry a system prompt in manifest.json. */
  systemPrompt: z.string().optional(),
});
export type SkillManifest = z.infer<typeof SkillManifestSchema>;

/** Codex-specific extras pulled from `agents/openai.yaml` when present. */
export const CodexExtrasSchema = z
  .object({
    /** UI metadata for the Codex app (label, icon, etc.). */
    interface: z.record(z.string(), z.unknown()).optional(),
    /** Invocation policy (always/manual/etc). Free-form. */
    policy: z.string().optional(),
    /** Tool dependencies declared by the Codex ecosystem. */
    dependencies: z.array(z.string()).default([]),
  })
  .partial();
export type CodexExtras = z.infer<typeof CodexExtrasSchema>;

export const SkillSourceRefSchema = z.object({
  /** Source id from lib/skills/sources.ts. */
  id: z.string(),
  kind: z.string(),
  scope: z.string(),
  label: z.string(),
  origin: z.string(),
  path: z.string(),
});
export type SkillSourceRef = z.infer<typeof SkillSourceRefSchema>;

export const SkillSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string(),
  version: z.string(),
  tags: z.array(z.string()),
  tools: z.array(z.string()),
  model: z.string().optional(),
  license: z.string().optional(),
  compatibility: z.string().optional(),
  metadata: z.record(z.string(), z.string()),
  /** Full prompt body — SKILL.md minus the frontmatter. */
  prompt: z.string(),
  /** Absolute path to the skill folder on disk. */
  path: z.string(),
  /** true when the skill folder is writable (edit / delete allowed). */
  writable: z.boolean(),
  /** Provenance — which source this skill came from. */
  source: SkillSourceRefSchema,
  /** Codex extras when `agents/openai.yaml` is present. */
  codex: CodexExtrasSchema.optional(),
});
export type Skill = z.infer<typeof SkillSchema>;
