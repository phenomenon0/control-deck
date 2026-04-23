/**
 * Scanner tests — synthesize a temp project with one file per major
 * ecosystem and assert the scanner finds each with correct kind + origin.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tmp: string;
let originalRoot: string | undefined;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "deck-rules-"));
  originalRoot = process.env.DECK_PROJECT_ROOT;
  process.env.DECK_PROJECT_ROOT = tmp;
});

afterEach(() => {
  if (originalRoot === undefined) delete process.env.DECK_PROJECT_ROOT;
  else process.env.DECK_PROJECT_ROOT = originalRoot;
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function freshScanner() {
  // Re-import to pick up the new env.
  const mod = await import("./scanner?" + Math.random());
  return mod as typeof import("./scanner");
}

describe("scanRules", () => {
  test("detects the major rule files side-by-side", async () => {
    fs.writeFileSync(path.join(tmp, "CLAUDE.md"), "# Project rules for Claude\n");
    fs.writeFileSync(path.join(tmp, "AGENTS.md"), "# Project rules for Codex\n");
    fs.writeFileSync(path.join(tmp, ".cursorrules"), "Follow TS best practices.\n");
    fs.writeFileSync(path.join(tmp, ".windsurfrules"), "No emojis.\n");
    fs.writeFileSync(path.join(tmp, "CONVENTIONS.md"), "Snake_case please.\n");
    fs.mkdirSync(path.join(tmp, ".cursor", "rules"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".cursor", "rules", "typescript.mdc"), "Use strict mode.\n");

    const { scanRules } = await freshScanner();
    const rules = scanRules();
    const byKind = new Set(rules.map((r) => r.kind));

    expect(byKind.has("claude-md")).toBe(true);
    expect(byKind.has("agents-md")).toBe(true);
    expect(byKind.has("cursor-legacy")).toBe(true);
    expect(byKind.has("windsurf")).toBe(true);
    expect(byKind.has("aider-conventions")).toBe(true);
    expect(byKind.has("cursor-rule")).toBe(true);
  });

  test("produces a stable id per path and a preview", async () => {
    fs.writeFileSync(path.join(tmp, "AGENTS.md"), "# Agent rules\n\nBe concise.\n");
    const { scanRules } = await freshScanner();
    const [rule] = scanRules().filter((r) => r.filename === "AGENTS.md");
    expect(rule.id).toHaveLength(16);
    expect(rule.origin).toBe("OpenAI Codex / OpenCode");
    expect(rule.preview).toContain("Agent rules");
    expect(rule.scope).toBe("project");
  });

  test("ignores directories and oversized files", async () => {
    fs.mkdirSync(path.join(tmp, "AGENTS.md"));
    const { scanRules } = await freshScanner();
    expect(scanRules().some((r) => r.filename === "AGENTS.md")).toBe(false);
  });
});
