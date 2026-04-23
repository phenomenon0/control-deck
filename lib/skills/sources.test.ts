/**
 * Sources layer is pure (no DB, no fs mutation) — test the eight built-in
 * entries exist and the override + custom layer compose correctly.
 */

import { describe, expect, test, beforeEach } from "bun:test";
import { builtInSources, resolveSources } from "./sources";

describe("builtInSources", () => {
  beforeEach(() => {
    delete process.env.DECK_PROJECT_ROOT;
    delete process.env.DECK_SKILLS_DIR;
  });

  test("contains every ecosystem's path", () => {
    const sources = builtInSources();
    const ids = sources.map((s) => s.id).sort();
    expect(ids).toContain("local");
    expect(ids).toContain("claude-user");
    expect(ids).toContain("claude-project");
    expect(ids).toContain("opencode-user");
    expect(ids).toContain("opencode-project");
    expect(ids).toContain("codex-user");
    expect(ids).toContain("codex-project");
    expect(ids).toContain("codex-system");
  });

  test("every entry resolves to an absolute path", () => {
    for (const s of builtInSources()) {
      expect(s.path.startsWith("/")).toBe(true);
    }
  });

  test("codex-system defaults to disabled, user dirs default to enabled", () => {
    const sources = builtInSources();
    expect(sources.find((s) => s.id === "codex-system")!.enabled).toBe(false);
    expect(sources.find((s) => s.id === "claude-user")!.enabled).toBe(true);
    expect(sources.find((s) => s.id === "opencode-user")!.enabled).toBe(true);
  });
});

describe("resolveSources", () => {
  test("override toggles the enabled flag for one source", () => {
    const sources = resolveSources({ "claude-user": { enabled: false } }, []);
    expect(sources.find((s) => s.id === "claude-user")!.enabled).toBe(false);
    expect(sources.find((s) => s.id === "claude-project")!.enabled).toBe(true);
  });

  test("custom sources append to defaults", () => {
    const sources = resolveSources({}, [
      { id: "custom-team", label: "Team skills", path: "/tmp/team-skills", enabled: true },
    ]);
    const custom = sources.find((s) => s.id === "custom-team");
    expect(custom).toBeDefined();
    expect(custom!.kind).toBe("custom");
    expect(custom!.enabled).toBe(true);
  });
});
