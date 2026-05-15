/**
 * Tests for the skill_manage handler. Uses an isolated tmp dir as both
 * project root and skills root so the loader sees only what we create.
 * Random ids avoid colliding with any real skills the loader might still
 * scan from disabled-but-existing default sources.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { executeSkillManage } from "./skill-manage";

let tmpRoot: string;
let skillsDir: string;
let uniqueId: string;
let prevProjectRoot: string | undefined;
let prevSkillsDir: string | undefined;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cd-skillmanage-"));
  skillsDir = path.join(tmpRoot, "skills");
  fs.mkdirSync(skillsDir, { recursive: true });
  uniqueId = `manage-skill-${crypto.randomBytes(4).toString("hex")}`;
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

describe("executeSkillManage", () => {
  test("create writes SKILL.md and returns a summary", async () => {
    const res = await executeSkillManage({
      action: "create",
      id: uniqueId,
      name: "Quick Skill",
      description: "Demo skill for handler tests",
      prompt: "Do the demo thing.",
      tools: ["vector_search"],
    });
    expect(res.success).toBe(true);
    expect(res.message).toContain(`created skill ${uniqueId}`);
    const onDisk = fs.readFileSync(path.join(skillsDir, uniqueId, "SKILL.md"), "utf8");
    expect(onDisk).toContain("name: Quick Skill");
    expect(onDisk).toContain("Do the demo thing.");
  });

  test("create rejects an unknown tool name", async () => {
    const res = await executeSkillManage({
      action: "create",
      id: uniqueId,
      name: "Bad Skill",
      description: "Should fail",
      prompt: "...",
      tools: ["definitely_not_a_tool"],
    });
    expect(res.success).toBe(false);
    expect(res.error_code).toBe("skill_unknown_tools");
    expect(fs.existsSync(path.join(skillsDir, uniqueId))).toBe(false);
  });

  test("create on a duplicate id returns skill_already_exists", async () => {
    await executeSkillManage({
      action: "create",
      id: uniqueId,
      name: "First",
      description: "first",
      prompt: "first body",
    });
    const dup = await executeSkillManage({
      action: "create",
      id: uniqueId,
      name: "Second",
      description: "second",
      prompt: "second body",
    });
    expect(dup.success).toBe(false);
    expect(dup.error_code).toBe("skill_already_exists");
  });

  test("update modifies an existing skill's description", async () => {
    await executeSkillManage({
      action: "create",
      id: uniqueId,
      name: "Skill",
      description: "old description",
      prompt: "body",
    });
    const res = await executeSkillManage({
      action: "update",
      id: uniqueId,
      description: "new description",
    });
    expect(res.success).toBe(true);
    const onDisk = fs.readFileSync(path.join(skillsDir, uniqueId, "SKILL.md"), "utf8");
    expect(onDisk).toContain("description: new description");
  });

  test("update on a missing id returns skill_not_found", async () => {
    const res = await executeSkillManage({
      action: "update",
      id: uniqueId,
      description: "nope",
    });
    expect(res.success).toBe(false);
    expect(res.error_code).toBe("skill_not_found");
  });

  test("delete removes the skill folder", async () => {
    await executeSkillManage({
      action: "create",
      id: uniqueId,
      name: "Doomed",
      description: "to delete",
      prompt: "body",
    });
    const res = await executeSkillManage({ action: "delete", id: uniqueId });
    expect(res.success).toBe(true);
    expect(fs.existsSync(path.join(skillsDir, uniqueId))).toBe(false);
  });

  test("delete on a missing id returns skill_not_found", async () => {
    const res = await executeSkillManage({ action: "delete", id: uniqueId });
    expect(res.success).toBe(false);
    expect(res.error_code).toBe("skill_not_found");
  });
});
