/**
 * Loader tests against fixture directories — the loader is the deck's
 * filesystem index over the same SKILL.md trees agent-ts scans, so the
 * cases here mirror agent-ts's discovery semantics: recursive category
 * folders (up to SKILL_SCAN_MAX_DEPTH), dot/underscore pruning, folder-name
 * fallback id. `scanSkills`/`scanSkill` take explicit sources + overrides,
 * keeping the tests hermetic (no settings DB, no host filesystem).
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { collectSkillFolders, scanSkill, scanSkills } from "./loader";
import { SKILL_SCAN_MAX_DEPTH } from "./roots";
import type { SkillSource } from "./sources";

let tmp: string;

function makeSource(root: string, over: Partial<SkillSource> = {}): SkillSource {
  return {
    id: over.id ?? "test",
    kind: "custom",
    scope: "user",
    label: "Test source",
    origin: "test",
    path: root,
    exists: true,
    enabled: true,
    ...over,
  };
}

function writeSkill(rel: string, frontmatter: Record<string, unknown>, body = "Do the thing.\n"): string {
  const folder = path.join(tmp, rel);
  fs.mkdirSync(folder, { recursive: true });
  const lines = Object.entries(frontmatter).map(([k, v]) =>
    Array.isArray(v) ? `${k}: [${v.join(", ")}]` : `${k}: ${String(v)}`,
  );
  fs.writeFileSync(path.join(folder, "SKILL.md"), `---\n${lines.join("\n")}\n---\n\n${body}`, "utf8");
  return folder;
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "deck-skills-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("scanSkills discovery", () => {
  test("finds a flat skill folder with frontmatter fields", () => {
    writeSkill("alpha", { name: "Alpha", description: "first skill", tags: ["a", "b"] });
    const skills = scanSkills([makeSource(tmp)]);
    expect(skills).toHaveLength(1);
    expect(skills[0].id).toBe("alpha");
    expect(skills[0].name).toBe("Alpha");
    expect(skills[0].description).toBe("first skill");
    expect(skills[0].tags).toEqual(["a", "b"]);
    expect(skills[0].path).toBe(path.join(tmp, "alpha"));
    expect(skills[0].enabled).toBe(true);
    expect(skills[0].prompt).toBe("Do the thing.");
  });

  test("finds skills nested in category folders (agent-ts parity)", () => {
    writeSkill("research/market", { name: "Market", description: "nested under a category" });
    const skills = scanSkills([makeSource(tmp)]);
    expect(skills).toHaveLength(1);
    expect(skills[0].id).toBe("market");
    expect(skills[0].path).toBe(path.join(tmp, "research", "market"));
  });

  test("skips dot and underscore folders", () => {
    writeSkill(".hidden/secret", { name: "Secret", description: "x" });
    writeSkill("_drafts/wip", { name: "Wip", description: "x" });
    writeSkill("visible", { name: "Visible", description: "x" });
    const skills = scanSkills([makeSource(tmp)]);
    expect(skills.map((s) => s.id)).toEqual(["visible"]);
  });

  test("respects the shared scan-depth cap", () => {
    const deep = ["a", "b", "c", "d", "e", "too-deep"].join("/");
    writeSkill(deep, { name: "Deep", description: "beyond the cap" });
    writeSkill("a/shallow", { name: "Shallow", description: "within the cap" });
    const skills = scanSkills([makeSource(tmp)]);
    expect(skills.map((s) => s.id)).toEqual(["shallow"]);
    // Sanity: the deep folder sits below the cap (6 levels > MAX_DEPTH).
    expect(deep.split("/").length).toBeGreaterThan(SKILL_SCAN_MAX_DEPTH);
  });

  test("frontmatter id wins over the folder name; folder name is the fallback", () => {
    writeSkill("folder-name", { id: "custom-id", name: "Custom", description: "x" });
    writeSkill("plain", { name: "Plain", description: "x" });
    const skills = scanSkills([makeSource(tmp)]);
    const ids = skills.map((s) => s.id).sort();
    expect(ids).toEqual(["custom-id", "plain"]);
  });

  test("first source wins on id collision", () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "deck-skills-b-"));
    try {
      writeSkill("dup", { name: "From A", description: "first source" });
      const folderB = path.join(other, "dup");
      fs.mkdirSync(folderB, { recursive: true });
      fs.writeFileSync(
        path.join(folderB, "SKILL.md"),
        "---\nname: From B\ndescription: second source\n---\n",
        "utf8",
      );
      const skills = scanSkills([makeSource(tmp, { id: "a" }), makeSource(other, { id: "b" })]);
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe("From A");
      expect(skills[0].source.id).toBe("a");
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });

  test("skips skills whose manifest fails validation", () => {
    writeSkill("no-name", { description: "missing the required name" });
    writeSkill("ok", { name: "Ok", description: "fine" });
    const skills = scanSkills([makeSource(tmp)]);
    expect(skills.map((s) => s.id)).toEqual(["ok"]);
  });

  test("disabled sources and missing roots are ignored", () => {
    writeSkill("alpha", { name: "Alpha", description: "x" });
    const skills = scanSkills([
      makeSource(tmp, { enabled: false }),
      makeSource(path.join(tmp, "does-not-exist"), { id: "gone", exists: false }),
    ]);
    expect(skills).toEqual([]);
  });

  test("results are sorted by display name", () => {
    writeSkill("zeta", { name: "Zulu", description: "x" });
    writeSkill("beta", { name: "Alpha", description: "x" });
    const skills = scanSkills([makeSource(tmp)]);
    expect(skills.map((s) => s.name)).toEqual(["Alpha", "Zulu"]);
  });
});

describe("enabled overlay", () => {
  test("marks skills disabled by path; missing key defaults to enabled", () => {
    const folderA = writeSkill("alpha", { name: "Alpha", description: "x" });
    writeSkill("beta", { name: "Beta", description: "x" });
    const skills = scanSkills([makeSource(tmp)], { [folderA]: { enabled: false } });
    expect(skills.find((s) => s.id === "alpha")!.enabled).toBe(false);
    expect(skills.find((s) => s.id === "beta")!.enabled).toBe(true);
  });

  test("scanSkill applies the overlay to single lookups", () => {
    const folder = writeSkill("alpha", { name: "Alpha", description: "x" });
    const sources = [makeSource(tmp)];
    expect(scanSkill("alpha", sources)!.enabled).toBe(true);
    expect(scanSkill("alpha", sources, { [folder]: { enabled: false } })!.enabled).toBe(false);
  });
});

describe("scanSkill", () => {
  test("returns null for unknown ids and finds nested skills by id", () => {
    writeSkill("research/market", { name: "Market", description: "x" });
    const sources = [makeSource(tmp)];
    expect(scanSkill("market", sources)?.name).toBe("Market");
    expect(scanSkill("nope", sources)).toBeNull();
  });
});

describe("collectSkillFolders", () => {
  test("treats a root containing SKILL.md as a skill (agent-ts parity)", () => {
    writeSkill(".", { name: "RootSkill", description: "x" });
    const folders = collectSkillFolders(tmp);
    expect(folders).toContain(tmp);
  });
});
