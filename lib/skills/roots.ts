/**
 * Shared skills layout — the one contract both skills systems obey.
 *
 * Canon (master plan, thread T9): the filesystem is the store. agent-ts
 * scans `<workspace>/skills/**\/SKILL.md` and exposes the files as native
 * tools (`skills_list` / `skill_view`); this package is the deck's index
 * over the SAME files (prompt index, Capabilities UI, bridge tools).
 *
 * The constants below mirror `apps/agent-ts/src/context/skills.ts`, which
 * keeps its own copy — cross-process imports from apps/agent-ts into lib/
 * are not allowed (separate package, separate runtime). If one side ever
 * changes the layout (dir name, file name, scan depth), change BOTH:
 *
 *   - here:                                   lib/skills/roots.ts
 *   - agent-ts copy:                          apps/agent-ts/src/context/skills.ts
 *
 * Layout:
 *
 *   <source-root>/                          e.g. <workspace>/skills/
 *     <skill-id>/SKILL.md                   flat skill
 *     <category>/<skill-id>/SKILL.md        categorised skill (nested)
 *
 * A skill is any directory containing SKILL.md, found by recursive descent
 * up to SKILL_SCAN_MAX_DEPTH levels below the source root. Frontmatter
 * carries at least `name` + `description` (see ./schema.ts); the folder
 * name is the fallback id, matching agent-ts's fallback name.
 */

/** Directory name agent-ts resolves under the workspace root. */
export const SKILLS_DIR_NAME = "skills";

/** File that marks a directory as a skill. */
export const SKILL_FILE_NAME = "SKILL.md";

/**
 * Recursive scan depth below a source root. agent-ts stops at depth 4
 * (`collectSkillFiles(root, depth = 0)` returns [] for depth > 4), so the
 * deck index uses the same cap — both systems see the same set of files.
 */
export const SKILL_SCAN_MAX_DEPTH = 4;
