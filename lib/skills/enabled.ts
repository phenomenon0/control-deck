/**
 * Per-skill enabled overlay — the thin replacement for the DB registry's
 * enabled flag (thread T9: the filesystem is the store; the registry is
 * gone). State lives in the `skills` settings section as `overrides`,
 * keyed by the skill's absolute folder path (`Skill.path`), and defaults
 * to enabled when no key exists.
 *
 * Why keyed by path, not id: ids can collide across sources (first source
 * wins), while the path identifies exactly one folder on disk — toggling
 * a shadowed duplicate never flips the wrong skill.
 *
 * Disabled skills stay visible in the API + Capabilities UI (greyed, with
 * a working re-enable toggle) but are filtered out of the prompt index by
 * `renderSkillIndex`, so the model never sees them advertised.
 */

import { setSetting } from "@/lib/agui/db";
import { resolveSection } from "@/lib/settings/resolve";
import { SkillsSettingsSchema, type SkillsSettings } from "@/lib/settings/schema";

export type SkillOverrides = Record<string, { enabled: boolean }>;

const FALLBACK: SkillsSettings = { indexInPrompt: true, indexDescChars: 140, overrides: {} };

function readSection(): SkillsSettings {
  try {
    return resolveSection("skills");
  } catch {
    return FALLBACK;
  }
}

/** Raw overrides map (path → { enabled }). Empty when settings are unreadable. */
export function readSkillOverrides(): SkillOverrides {
  return readSection().overrides ?? {};
}

/** Effective enabled state for one skill path. Default: enabled. */
export function skillEnabled(path: string, overrides: SkillOverrides = readSkillOverrides()): boolean {
  return overrides[path]?.enabled ?? true;
}

/**
 * Persist one skill's enabled flag. Enabling drops the override row
 * (enabled is the default) so the map stays sparse; disabling writes
 * `{ enabled: false }` for the path.
 */
export function setSkillEnabled(path: string, enabled: boolean): void {
  const current = readSection();
  const overrides: SkillOverrides = { ...current.overrides };
  if (enabled) {
    delete overrides[path];
  } else {
    overrides[path] = { enabled: false };
  }
  const parsed = SkillsSettingsSchema.safeParse({ ...current, overrides });
  if (!parsed.success) throw new Error("skills settings failed validation");
  setSetting("skills", parsed.data as unknown as Record<string, unknown>);
}
