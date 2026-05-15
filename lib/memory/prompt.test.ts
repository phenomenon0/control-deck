/**
 * Integration boundary: `renderMemoryForPrompt` is what the chat route and
 * Moby builder call. Tests verify the disabled path, the empty path, and
 * that budget overrides flow from settings opts into the snapshot.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { addEntry } from "./store";
import { renderMemoryForPrompt } from "./prompt";

let root: string;
let repo: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cd-mempr-root-"));
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "cd-mempr-repo-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(repo, { recursive: true, force: true });
});

describe("renderMemoryForPrompt", () => {
  test("returns empty string when no memory exists anywhere", () => {
    const out = renderMemoryForPrompt({ root, repoRoot: repo });
    expect(out).toBe("");
  });

  test("returns the rendered block when profile memory has entries", async () => {
    await addEntry("memory", "agent fact one", { root });
    await addEntry("user", "user pref one", { root });
    const out = renderMemoryForPrompt({ root, repoRoot: repo });
    expect(out).toContain("agent fact one");
    expect(out).toContain("user pref one");
    expect(out).toContain("# MEMORY");
    expect(out).toContain("# USER PROFILE");
  });

  test("returns empty string when explicitly disabled via opts", async () => {
    await addEntry("memory", "agent fact one", { root });
    const out = renderMemoryForPrompt({ root, repoRoot: repo, enabled: false });
    expect(out).toBe("");
  });

  test("budget override drops oldest entries from the block", () => {
    fs.writeFileSync(
      path.join(repo, "MEMORY.md"),
      Array.from({ length: 10 }, (_, i) => `- lesson ${i} ` + "x".repeat(100)).join("\n"),
      "utf8",
    );
    const out = renderMemoryForPrompt({
      root,
      repoRoot: repo,
      budgets: { memory: 300, user: 100 },
    });
    expect(out.length).toBeLessThan(700);
    expect(out).toContain("lesson 9");
  });
});
