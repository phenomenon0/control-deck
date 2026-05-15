/**
 * Tests for the skill_view handler. We point DECK_PROJECT_ROOT +
 * DECK_SKILLS_DIR at a fresh tmp dir so the loader sees an isolated
 * `local` source. A randomly-named skill id prevents collisions with any
 * other source the loader might still scan (~/.claude/skills, etc.).
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { executeSkillView } from "./skill";

let tmpRoot: string;
let skillsDir: string;
let uniqueId: string;
let prevProjectRoot: string | undefined;
let prevSkillsDir: string | undefined;

function writeSkill(id: string, frontmatter: string, body = "skill body"): void {
  const dir = path.join(skillsDir, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\n${frontmatter}\n---\n${body}\n`, "utf8");
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cd-skillview-"));
  skillsDir = path.join(tmpRoot, "skills");
  fs.mkdirSync(skillsDir, { recursive: true });
  uniqueId = `test-skill-${crypto.randomBytes(4).toString("hex")}`;
  prevProjectRoot = process.env.DECK_PROJECT_ROOT;
  prevSkillsDir = process.env.DECK_SKILLS_DIR;
  process.env.DECK_PROJECT_ROOT = tmpRoot;
  process.env.DECK_SKILLS_DIR = skillsDir;
});

afterEach(() => {
  if (prevProjectRoot === undefined) delete process.env.DECK_PROJECT_ROOT;
  else process.env.DECK_PROJECT_ROOT = prevProjectRoot;
  if (prevSkillsDir === undefined) delete process.env.DECK_SKILLS_DIR;
  else process.env.DECK_SKILLS_DIR = prevSkillsDir;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("executeSkillView", () => {
  test("returns the full prompt body and metadata for an existing skill", async () => {
    writeSkill(
      uniqueId,
      `name: Test Skill\ndescription: A skill used by handler tests\ntools: [vector_search, http_fetch]`,
      "FULL BODY GOES HERE",
    );

    const res = await executeSkillView({ id: uniqueId });

    expect(res.success).toBe(true);
    const data = res.data as {
      id: string;
      name: string;
      prompt: string;
      tools: string[];
      source: { kind: string };
    };
    expect(data.id).toBe(uniqueId);
    expect(data.name).toBe("Test Skill");
    expect(data.prompt).toContain("FULL BODY GOES HERE");
    expect(data.tools).toEqual(["vector_search", "http_fetch"]);
    expect(data.source.kind).toBe("local");
  });

  test("missing id returns skill_not_found, not_safe_to_retry", async () => {
    const res = await executeSkillView({ id: uniqueId });
    expect(res.success).toBe(false);
    expect(res.error_code).toBe("skill_not_found");
    expect(res.safe_to_retry).toBe(false);
    expect(res.recovery).toBeDefined();
  });

  test("whitespace-only id is rejected with skill_missing_id", async () => {
    const res = await executeSkillView({ id: "   " });
    expect(res.success).toBe(false);
    expect(res.error_code).toBe("skill_missing_id");
  });
});
