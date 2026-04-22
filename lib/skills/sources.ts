/**
 * Skill source registry.
 *
 * A source is a named directory the loader scans for skill folders. Each
 * source carries provenance — `kind` tells us which ecosystem the path
 * belongs to, `scope` separates user-level from project-level, and the
 * resolved `path` is absolute after variable expansion.
 *
 * Sources are derived from two layers:
 *   1. Built-in defaults (the list below) — one entry per well-known
 *      location across Claude Code, OpenCode, Codex, and the app's own
 *      `skills/` folder.
 *   2. User-added custom paths from settings (follow-up).
 *
 * The loader iterates enabled sources in listed order and deduplicates
 * skills by `id`. First occurrence wins — this mirrors how Claude Code
 * treats project skills as overriding personal skills.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type SourceKind =
  | "local" // this app's own skills/ dir
  | "claude-user" // ~/.claude/skills/
  | "claude-project" // .claude/skills/ in repo root
  | "opencode-user" // ~/.config/opencode/skills/
  | "opencode-project" // .opencode/skills/ in repo
  | "codex-user" // ~/.agents/skills/
  | "codex-project" // .agents/skills/ in repo
  | "codex-system" // /etc/codex/skills/
  | "custom"; // user-added

export type SourceScope = "user" | "project" | "app" | "system";

export interface SkillSource {
  /** Stable identifier — used as dedup key + persistence key for toggles. */
  id: string;
  kind: SourceKind;
  scope: SourceScope;
  /** Display label for the UI. */
  label: string;
  /** Short ecosystem origin (Anthropic / OpenCode / OpenAI / app). */
  origin: string;
  /** Absolute filesystem path after variable expansion. */
  path: string;
  /** True iff the directory currently exists on disk. */
  exists: boolean;
  /** Whether the loader should scan this source. */
  enabled: boolean;
}

/** Default enabled state by kind. User dirs default on; admin-only dirs off. */
const DEFAULT_ENABLED: Record<SourceKind, boolean> = {
  local: true,
  "claude-user": true,
  "claude-project": true,
  "opencode-user": true,
  "opencode-project": true,
  "codex-user": true,
  "codex-project": true,
  "codex-system": false,
  custom: true,
};

function expand(p: string): string {
  return p.replace(/^~(?=$|\/|\\)/, os.homedir());
}

function safeExists(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function projectRoot(): string {
  // Override for tests; otherwise cwd. The server runs from the app root so
  // cwd is sufficient.
  return process.env.DECK_PROJECT_ROOT ?? process.cwd();
}

export function builtInSources(): SkillSource[] {
  const home = os.homedir();
  const proj = projectRoot();
  const xdgConfig = process.env.XDG_CONFIG_HOME ?? path.join(home, ".config");

  // Order matters — earlier sources win on id collision.
  const raw: Array<Omit<SkillSource, "exists">> = [
    {
      id: "local",
      kind: "local",
      scope: "app",
      label: "Control Deck skills",
      origin: "this app",
      path: process.env.DECK_SKILLS_DIR ?? path.join(proj, "skills"),
      enabled: DEFAULT_ENABLED.local,
    },
    {
      id: "claude-project",
      kind: "claude-project",
      scope: "project",
      label: "Project · .claude/skills",
      origin: "Anthropic",
      path: path.join(proj, ".claude", "skills"),
      enabled: DEFAULT_ENABLED["claude-project"],
    },
    {
      id: "opencode-project",
      kind: "opencode-project",
      scope: "project",
      label: "Project · .opencode/skills",
      origin: "OpenCode",
      path: path.join(proj, ".opencode", "skills"),
      enabled: DEFAULT_ENABLED["opencode-project"],
    },
    {
      id: "codex-project",
      kind: "codex-project",
      scope: "project",
      label: "Project · .agents/skills",
      origin: "OpenAI Codex",
      path: path.join(proj, ".agents", "skills"),
      enabled: DEFAULT_ENABLED["codex-project"],
    },
    {
      id: "claude-user",
      kind: "claude-user",
      scope: "user",
      label: "User · ~/.claude/skills",
      origin: "Anthropic",
      path: path.join(home, ".claude", "skills"),
      enabled: DEFAULT_ENABLED["claude-user"],
    },
    {
      id: "opencode-user",
      kind: "opencode-user",
      scope: "user",
      label: "User · ~/.config/opencode/skills",
      origin: "OpenCode",
      path: path.join(xdgConfig, "opencode", "skills"),
      enabled: DEFAULT_ENABLED["opencode-user"],
    },
    {
      id: "codex-user",
      kind: "codex-user",
      scope: "user",
      label: "User · ~/.agents/skills",
      origin: "OpenAI Codex",
      path: path.join(home, ".agents", "skills"),
      enabled: DEFAULT_ENABLED["codex-user"],
    },
    {
      id: "codex-system",
      kind: "codex-system",
      scope: "system",
      label: "System · /etc/codex/skills",
      origin: "OpenAI Codex",
      path: "/etc/codex/skills",
      enabled: DEFAULT_ENABLED["codex-system"],
    },
  ];

  return raw.map((s) => ({
    ...s,
    path: expand(s.path),
    exists: safeExists(expand(s.path)),
  }));
}

export interface SourceOverride {
  enabled?: boolean;
  remove?: boolean;
}

export interface CustomSource {
  id: string;
  label: string;
  path: string;
  enabled: boolean;
}

/**
 * Resolve the final list by applying per-source overrides + appending any
 * user-added custom sources. Kept pure so tests can feed it synthetic input.
 */
export function resolveSources(
  overrides: Record<string, SourceOverride>,
  custom: CustomSource[],
): SkillSource[] {
  const defaults = builtInSources().map((s) => {
    const o = overrides[s.id];
    if (!o) return s;
    if (o.enabled !== undefined) s = { ...s, enabled: o.enabled };
    return s;
  });
  const customExpanded: SkillSource[] = custom.map((c) => ({
    id: c.id,
    kind: "custom",
    scope: "user",
    label: c.label,
    origin: "user-added",
    path: expand(c.path),
    exists: safeExists(expand(c.path)),
    enabled: c.enabled,
  }));
  return [...defaults, ...customExpanded];
}
