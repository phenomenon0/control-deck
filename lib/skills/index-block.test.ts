/**
 * Tests for renderSkillIndex — the system-prompt visible piece of the
 * progressive-disclosure pair. We pass `skills` directly so the test
 * doesn't depend on the host filesystem or settings DB.
 */

import { describe, expect, test } from "bun:test";

import { renderSkillIndex } from "./index-block";
import type { Skill } from "./schema";

function makeSkill(over: Partial<Skill> = {}): Skill {
  const id = over.id ?? "test-skill";
  return {
    id,
    name: over.name ?? "Test Skill",
    description: over.description ?? "A short description for the index.",
    version: "0.1.0",
    tags: [],
    tools: [],
    metadata: {},
    prompt: "body",
    path: `/tmp/${id}`,
    writable: true,
    source: {
      id: "local",
      kind: "local",
      scope: "app",
      label: "Control Deck skills",
      origin: "this app",
      path: "/tmp/skills",
    },
    ...over,
  };
}

describe("renderSkillIndex", () => {
  test("returns empty string when no skills exist", () => {
    expect(renderSkillIndex({ skills: [] })).toBe("");
  });

  test("returns empty string when disabled explicitly", () => {
    const out = renderSkillIndex({
      skills: [makeSkill()],
      enabled: false,
    });
    expect(out).toBe("");
  });

  test("renders one line per skill with id, source.kind, description", () => {
    const out = renderSkillIndex({
      skills: [
        makeSkill({ id: "alpha", description: "alpha skill" }),
        makeSkill({ id: "bravo", description: "bravo skill" }),
      ],
    });
    expect(out).toContain("# SKILLS");
    expect(out).toContain("- alpha [local] — alpha skill");
    expect(out).toContain("- bravo [local] — bravo skill");
  });

  test("truncates long descriptions to the configured budget", () => {
    const longDesc = "x".repeat(500);
    const out = renderSkillIndex({
      skills: [makeSkill({ id: "longone", description: longDesc })],
      descChars: 60,
    });
    const line = out.split("\n").find((l) => l.startsWith("- longone"));
    expect(line).toBeDefined();
    // The truncated description is at most descChars wide (including ellipsis).
    const descPart = line!.split("— ")[1] ?? "";
    expect(descPart.length).toBeLessThanOrEqual(60);
    expect(descPart.endsWith("…")).toBe(true);
  });

  test("flattens whitespace in descriptions to a single line", () => {
    const out = renderSkillIndex({
      skills: [makeSkill({ id: "multi", description: "line one\n\nline two\n\tline three" })],
    });
    const line = out.split("\n").find((l) => l.startsWith("- multi"));
    expect(line).toBe("- multi [local] — line one line two line three");
  });

  test("includes the skill_view usage hint in the header", () => {
    const out = renderSkillIndex({ skills: [makeSkill()] });
    expect(out.split("\n")[0]).toContain("skill_view");
  });
});
