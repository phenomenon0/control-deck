/**
 * Skill catalog → compact prompt block.
 *
 * Progressive disclosure: the system prompt carries only the *index* (id +
 * one-line description + source kind). The full body is loaded on demand
 * via the `skill_view` tool. This keeps the prompt prefix short and
 * cacheable while the model still knows what's available.
 *
 * The catalog is the filesystem index from ./loader — the same SKILL.md
 * files agent-ts exposes as tools. Skills disabled through the settings
 * overlay (./enabled, keyed by path) are filtered out here so the model
 * never sees them advertised.
 *
 * Returns "" when there are no enabled skills or the feature is disabled
 * in settings, so callers can splice unconditionally without producing a
 * dead heading.
 */

import { loadSkills } from "./loader";
import type { Skill } from "./schema";
import { resolveSection } from "@/lib/settings/resolve";

export interface RenderSkillIndexOpts {
  /** Override settings — when false, returns "". */
  enabled?: boolean;
  /** Override description truncation length. */
  descChars?: number;
  /** Inject a pre-loaded skill list. Tests use this; production passes nothing. */
  skills?: Skill[];
}

function truncateOneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return flat.slice(0, Math.max(1, max - 1)).trimEnd() + "…";
}

/**
 * Render the index block. Format is intentionally terse — one line per
 * skill so a 30-skill catalog fits in well under 2 KB.
 *
 *   # SKILLS (use skill_view id="…" for full body)
 *   - <id> [<source.kind>] — <truncated description>
 */
export function renderSkillIndex(opts: RenderSkillIndexOpts = {}): string {
  let settings: { indexInPrompt: boolean; indexDescChars: number };
  try {
    settings = resolveSection("skills");
  } catch {
    settings = { indexInPrompt: true, indexDescChars: 140 };
  }

  const enabled = opts.enabled ?? settings.indexInPrompt;
  if (!enabled) return "";

  const skills = (opts.skills ?? loadSkills()).filter((s) => s.enabled !== false);
  if (skills.length === 0) return "";

  const max = opts.descChars ?? settings.indexDescChars;
  const lines = [
    "# SKILLS (use skill_view id=\"…\" for full body)",
    ...skills.map((s) => `- ${s.id} [${s.source.kind}] — ${truncateOneLine(s.description, max)}`),
  ];
  return lines.join("\n");
}
