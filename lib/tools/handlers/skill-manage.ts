/**
 * `skill_manage` tool handler — wraps lib/skills/writer with the validation
 * layer that gates the auto-executing MCP path:
 *
 *   - Writable-root check (filesystem must be writable; read-only deploys
 *     surface a clear refusal instead of throwing fs errors).
 *   - Slug validation (already enforced by writer; re-asserted here for a
 *     better error code).
 *   - Tools-list whitelist: every entry must be a known bridge tool, so a
 *     skill can't legitimize a tool name the deck doesn't expose.
 *   - Body size cap is enforced by the schema (max 64 KB) — anything
 *     larger should go in `references/` or `scripts/`, not the body.
 *
 * The writer functions throw on collisions / missing skills; we translate
 * those into structured ToolExecutionResult shapes so the agent can recover.
 */

import type { SkillManageToolArgs } from "../definitions";
import type { ToolExecutionResult } from "../executor";
import { BRIDGE_TOOLS } from "../bridgeToolList";
import { createSkill, updateSkill, deleteSkill } from "@/lib/skills/writer";
import { rootIsWritable, writableRoot, loadSkill } from "@/lib/skills/loader";
import type { Skill, SkillManifest } from "@/lib/skills/schema";

interface ManageErrorShape {
  message: string;
  error_code: string;
  recovery: string[];
  safeToRetry: boolean;
}

function classify(raw: string): ManageErrorShape {
  const lower = raw.toLowerCase();
  if (lower.startsWith("invalid skill id")) {
    return {
      message: raw,
      error_code: "skill_invalid_id",
      recovery: ["Use a kebab-case slug starting with [a-z0-9], up to 64 chars"],
      safeToRetry: false,
    };
  }
  if (lower.startsWith("skill already exists")) {
    return {
      message: raw,
      error_code: "skill_already_exists",
      recovery: [
        "Use action=update if you intended to modify the existing skill",
        "Pick a different id for the new skill",
      ],
      safeToRetry: false,
    };
  }
  if (lower.startsWith("skill not found")) {
    return {
      message: raw,
      error_code: "skill_not_found",
      recovery: ["Check the id against the SKILLS index", "Use action=create if the skill does not yet exist"],
      safeToRetry: false,
    };
  }
  return {
    message: raw,
    error_code: "skill_manage_error",
    recovery: ["Inspect the message and retry with corrected args"],
    safeToRetry: false,
  };
}

function unknownTools(tools: string[] | undefined): string[] {
  if (!tools) return [];
  return tools.filter((t) => !BRIDGE_TOOLS.has(t));
}

function summarize(skill: Skill): {
  id: string;
  name: string;
  path: string;
  version: string;
  tools: string[];
  promptChars: number;
  source: { kind: string; id: string };
} {
  return {
    id: skill.id,
    name: skill.name,
    path: skill.path,
    version: skill.version,
    tools: skill.tools,
    promptChars: skill.prompt.length,
    source: { kind: skill.source.kind, id: skill.source.id },
  };
}

export async function executeSkillManage(args: SkillManageToolArgs): Promise<ToolExecutionResult> {
  // Read-only deployments (e.g. Vercel) — fail fast with a clear code so the
  // agent stops trying instead of looping through every CRUD action.
  if (!rootIsWritable()) {
    return {
      success: false,
      message: `skills root is not writable: ${writableRoot()}`,
      error: "read_only_root",
      error_code: "skill_root_readonly",
      recovery: [
        "Run on a host where the local skills directory is writable",
        "Set DECK_SKILLS_DIR to a path you can write to",
      ],
      safe_to_retry: false,
    };
  }

  // Reject manifests that legitimize unknown tool names — the agent should
  // not be able to mint a tool surface that bypasses the bridge allowlist.
  const unknown = unknownTools(args.tools);
  if (unknown.length > 0) {
    return {
      success: false,
      message: `unknown tools in manifest: ${unknown.join(", ")}`,
      error: "unknown_tools",
      error_code: "skill_unknown_tools",
      recovery: [
        "Drop the unknown names from `tools`",
        "Only include names listed in the bridge tool catalog (see the deck's MCP `tools/list`)",
      ],
      safe_to_retry: false,
    };
  }

  try {
    switch (args.action) {
      case "create": {
        const manifest: SkillManifest = {
          id: args.id,
          name: args.name!,
          description: args.description!,
          version: args.version ?? "0.1.0",
          tags: args.tags ?? [],
          tools: args.tools ?? [],
          model: args.model,
          license: args.license,
          compatibility: args.compatibility,
          metadata: args.metadata ?? {},
        };
        const skill = createSkill({ id: args.id, manifest, prompt: args.prompt! });
        return {
          success: true,
          message: `created skill ${skill.id} at ${skill.path}`,
          data: { action: "create", skill: summarize(skill) },
        };
      }
      case "update": {
        const existing = loadSkill(args.id!);
        if (!existing) {
          return {
            success: false,
            message: `skill not found: ${args.id}`,
            error: "not_found",
            error_code: "skill_not_found",
            recovery: ["Check the id against the SKILLS index", "Use action=create if the skill does not yet exist"],
            safe_to_retry: false,
          };
        }
        const manifest: Partial<SkillManifest> = {};
        if (args.name !== undefined) manifest.name = args.name;
        if (args.description !== undefined) manifest.description = args.description;
        if (args.version !== undefined) manifest.version = args.version;
        if (args.tags !== undefined) manifest.tags = args.tags;
        if (args.tools !== undefined) manifest.tools = args.tools;
        if (args.model !== undefined) manifest.model = args.model;
        if (args.license !== undefined) manifest.license = args.license;
        if (args.compatibility !== undefined) manifest.compatibility = args.compatibility;
        if (args.metadata !== undefined) manifest.metadata = args.metadata;
        const skill = updateSkill({ id: args.id!, manifest, prompt: args.prompt });
        return {
          success: true,
          message: `updated skill ${skill.id}`,
          data: { action: "update", skill: summarize(skill) },
        };
      }
      case "delete": {
        const existing = loadSkill(args.id!);
        if (!existing) {
          return {
            success: false,
            message: `skill not found: ${args.id}`,
            error: "not_found",
            error_code: "skill_not_found",
            recovery: ["Check the id against the SKILLS index"],
            safe_to_retry: false,
          };
        }
        // The writer only deletes from the local writable root. Refuse if the
        // skill came from a foreign source so the model can't wipe Anthropic
        // / OpenCode / Codex skills shared from another tool.
        if (existing.source.kind !== "local") {
          return {
            success: false,
            message: `cannot delete ${existing.id}: skill is owned by source ${existing.source.kind}`,
            error: "foreign_source",
            error_code: "skill_foreign_source",
            recovery: [
              "Delete the folder directly from the owning ecosystem",
              "Only local-source skills can be removed via skill_manage",
            ],
            safe_to_retry: false,
          };
        }
        deleteSkill(args.id!);
        return {
          success: true,
          message: `deleted skill ${args.id}`,
          data: { action: "delete", id: args.id },
        };
      }
    }
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err ?? "skill_manage failed");
    const shape = classify(raw);
    return {
      success: false,
      message: shape.message,
      error: shape.message,
      error_code: shape.error_code,
      recovery: shape.recovery,
      safe_to_retry: shape.safeToRetry,
    };
  }
}
