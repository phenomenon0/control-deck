/**
 * `skill_view` tool handler — progressive-disclosure read for skills.
 *
 * The system prompt only carries a compact index (id + truncated desc).
 * When the agent decides a skill applies, it calls this tool with the id to
 * fetch the full SKILL.md body, tool whitelist, and source metadata.
 *
 * Read-only by design — there's no filesystem write surface to gate.
 */

import type { SkillViewToolArgs } from "../definitions";
import type { ToolExecutionResult } from "../executor";
import { loadSkill } from "@/lib/skills/loader";

export async function executeSkillView(
  args: SkillViewToolArgs,
): Promise<ToolExecutionResult> {
  const id = args.id.trim();
  if (!id) {
    return {
      success: false,
      message: "skill_view requires a non-empty id",
      error: "missing_id",
      error_code: "skill_missing_id",
      recovery: ["Pass the id from the SKILLS index, e.g. id=\"browser-harness\""],
      safe_to_retry: false,
    };
  }

  const skill = loadSkill(id);
  if (!skill) {
    return {
      success: false,
      message: `skill not found: ${id}`,
      error: "not_found",
      error_code: "skill_not_found",
      recovery: [
        "Check the SKILLS index for the exact id (kebab-case, matches the folder name)",
        "If the skill was just added, refresh — the loader scans on each call but case matters",
      ],
      safe_to_retry: false,
    };
  }

  return {
    success: true,
    message: `loaded skill ${skill.id} (${skill.prompt.length} chars)`,
    data: {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      version: skill.version,
      tags: skill.tags,
      tools: skill.tools,
      model: skill.model ?? null,
      license: skill.license ?? null,
      compatibility: skill.compatibility ?? null,
      metadata: skill.metadata,
      source: skill.source,
      path: skill.path,
      writable: skill.writable,
      prompt: skill.prompt,
      codex: skill.codex ?? null,
    },
  };
}
