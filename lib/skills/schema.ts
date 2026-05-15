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

/**
 * Tool input for the `skill_manage` MCP tool. Discriminated by `action`:
 *
 *   - create: needs `name` + `description` + `prompt`; id, version, tags,
 *     tools, model, license, compatibility are optional.
 *   - update: needs `id`; any subset of the manifest fields and/or `prompt`.
 *   - delete: needs only `id`.
 *
 * Tools mentioned in `tools` must be valid bridge tool names — the handler
 * does the runtime check against BRIDGE_TOOLS to avoid a circular import
 * here.
 */
export const SkillIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-_]*$/i, "id must be a kebab/underscore slug starting with [a-z0-9]")
  .min(1)
  .max(64);

export const SkillManageInputSchema = z
  .object({
    action: z.enum(["create", "update", "delete"]),
    id: z.string().optional(),
    name: z.string().min(1).max(120).optional(),
    description: z.string().min(1).max(1000).optional(),
    prompt: z.string().max(64_000).optional(),
    version: z.string().max(32).optional(),
    tags: z.array(z.string().min(1).max(64)).max(32).optional(),
    tools: z.array(z.string().min(1).max(64)).max(64).optional(),
    model: z.string().max(120).optional(),
    license: z.string().max(64).optional(),
    compatibility: z.string().max(120).optional(),
    metadata: z.record(z.string(), z.string()).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.action === "create") {
      if (!val.name) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "create requires name", path: ["name"] });
      }
      if (!val.description) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "create requires description", path: ["description"] });
      }
      if (val.prompt === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "create requires prompt", path: ["prompt"] });
      }
      if (val.id) {
        const parsed = SkillIdSchema.safeParse(val.id);
        if (!parsed.success) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: parsed.error.issues[0].message, path: ["id"] });
        }
      }
    } else {
      if (!val.id) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${val.action} requires id`, path: ["id"] });
      } else {
        const parsed = SkillIdSchema.safeParse(val.id);
        if (!parsed.success) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: parsed.error.issues[0].message, path: ["id"] });
        }
      }
      if (val.action === "update") {
        const hasAny =
          val.name !== undefined ||
          val.description !== undefined ||
          val.prompt !== undefined ||
          val.version !== undefined ||
          val.tags !== undefined ||
          val.tools !== undefined ||
          val.model !== undefined ||
          val.license !== undefined ||
          val.compatibility !== undefined ||
          val.metadata !== undefined;
        if (!hasAny) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "update requires at least one field to change",
            path: [],
          });
        }
      }
    }
  });
export type SkillManageInput = z.infer<typeof SkillManageInputSchema>;

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
