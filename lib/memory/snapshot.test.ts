/**
 * Snapshot tests pin the three behaviors the prompt assembler relies on:
 * profile wins over repo-seed, repo-seed bullet format parses, and the
 * snapshot stays bounded by the per-target budget.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { addEntry } from "./store";
import { loadMemorySnapshot, renderSnapshot } from "./snapshot";

let root: string;
let repo: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cd-snap-root-"));
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "cd-snap-repo-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(repo, { recursive: true, force: true });
});

describe("loadMemorySnapshot", () => {
  test("returns empty blocks when neither profile nor repo seed exists", () => {
    const snap = loadMemorySnapshot({ root, repoRoot: repo });
    expect(snap.memory.text).toBe("");
    expect(snap.user.text).toBe("");
    expect(snap.memory.source).toBe("empty");
    expect(snap.user.source).toBe("empty");
  });

  test("falls back to repo-seed when profile is absent — bullet format parses", () => {
    fs.writeFileSync(
      path.join(repo, "MEMORY.md"),
      "# Control Deck Memory\n\nIntro text that should be dropped.\n\n## Current Lessons\n\n- First lesson.\n- Second lesson.\n",
      "utf8",
    );
    const snap = loadMemorySnapshot({ root, repoRoot: repo });
    expect(snap.memory.source).toBe("repo-seed");
    expect(snap.memory.entryCount).toBe(2);
    expect(snap.memory.text).toContain("First lesson.");
    expect(snap.memory.text).toContain("Second lesson.");
    expect(snap.memory.text).not.toContain("Intro text");
  });

  test("profile beats repo-seed when both exist", async () => {
    fs.writeFileSync(path.join(repo, "MEMORY.md"), "- repo entry\n", "utf8");
    await addEntry("memory", "profile entry", { root });

    const snap = loadMemorySnapshot({ root, repoRoot: repo });
    expect(snap.memory.source).toBe("profile");
    expect(snap.memory.text).toContain("profile entry");
    expect(snap.memory.text).not.toContain("repo entry");
  });

  test("dedupes identical entries across the file", () => {
    fs.writeFileSync(
      path.join(repo, "USER.md"),
      "- prefer autonomy\n- Prefer Autonomy\n- keep prompts lean\n",
      "utf8",
    );
    const snap = loadMemorySnapshot({ root, repoRoot: repo });
    expect(snap.user.entryCount).toBe(2);
  });

  test("respects per-target budget by dropping oldest entries", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `- lesson ${i} ` + "x".repeat(50)).join("\n");
    fs.writeFileSync(path.join(repo, "MEMORY.md"), lines, "utf8");

    const snap = loadMemorySnapshot({ root, repoRoot: repo, budgets: { memory: 400 } });
    expect(snap.memory.text.length).toBeLessThanOrEqual(snap.memory.budget + 100); // heading
    expect(snap.memory.entryCount).toBeGreaterThan(0);
    // Oldest should be dropped — the last lesson stays.
    expect(snap.memory.text).toContain("lesson 29");
  });
});

describe("renderSnapshot", () => {
  test("concatenates both blocks with a blank line between them", async () => {
    await addEntry("memory", "agent fact", { root });
    await addEntry("user", "user pref", { root });

    const snap = loadMemorySnapshot({ root, repoRoot: repo });
    const out = renderSnapshot(snap);
    expect(out).toContain("# MEMORY");
    expect(out).toContain("# USER PROFILE");
    expect(out.indexOf("# MEMORY")).toBeLessThan(out.indexOf("# USER PROFILE"));
  });

  test("emits only the non-empty block when one target is empty", async () => {
    await addEntry("memory", "agent fact", { root });
    const snap = loadMemorySnapshot({ root, repoRoot: repo });
    const out = renderSnapshot(snap);
    expect(out).toContain("# MEMORY");
    expect(out).not.toContain("# USER PROFILE");
  });
});
