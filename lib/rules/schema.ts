/**
 * Rule-file schema — a cross-ecosystem agent-rules observatory.
 *
 * A "rule file" is any of the instruction-style documents each coding-agent
 * ecosystem hides inside its own context window:
 *
 *   Claude Code  → CLAUDE.md, CLAUDE.local.md, ~/.claude/CLAUDE.md
 *   Codex        → AGENTS.md, AGENTS.override.md, ~/.codex/AGENTS.md
 *   OpenCode     → AGENTS.md (it reuses the Codex convention)
 *   Cursor       → .cursorrules (legacy), .cursor/rules/*.mdc (modular)
 *   Windsurf     → .windsurfrules
 *   Aider        → CONVENTIONS.md
 *
 * We never *adopt* these into our own runtime — the user's agent has
 * already consumed them, and merging them would be a composition nightmare.
 * The value here is visibility: "what rules are in play right now across
 * every agent touching this repo, and what do they say?"
 */

export type RuleKind =
  | "claude-md" // CLAUDE.md
  | "claude-local" // CLAUDE.local.md (gitignored overrides)
  | "claude-user" // ~/.claude/CLAUDE.md
  | "agents-md" // AGENTS.md (Codex / OpenCode)
  | "agents-override" // AGENTS.override.md (Codex)
  | "agents-user" // ~/.codex/AGENTS.md
  | "cursor-legacy" // .cursorrules
  | "cursor-rule" // .cursor/rules/<name>.mdc
  | "windsurf" // .windsurfrules
  | "aider-conventions" // CONVENTIONS.md
  | "continue" // .continuerules
  | "opencode-config"; // opencode.json / opencode.jsonc

export type RuleScope = "project" | "parent" | "user" | "system";

export interface RuleFile {
  /** Stable key — hash of absolute path. */
  id: string;
  kind: RuleKind;
  scope: RuleScope;
  /** Origin ecosystem label for the UI (Anthropic / OpenAI / Cursor / etc). */
  origin: string;
  /** Absolute filesystem path. */
  path: string;
  /** Filename only, for the list. */
  filename: string;
  /** Parent directory, relative to the scan root when possible. */
  relativeDir: string;
  /** Byte size of the file. */
  size: number;
  /** Modified time. */
  modifiedAt: string;
  /** First N chars of content for the list preview. */
  preview: string;
  /** Line count (cheap heuristic for "how much is in here"). */
  lineCount: number;
}
