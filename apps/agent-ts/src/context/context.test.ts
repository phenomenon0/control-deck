/**
 * Smoke tests for the context layer (bootstrap, skills, domain-skills).
 *
 * Lays out a temporary fake workspace under os.tmpdir() and exercises each
 * module against it. Run with: `tsx --test src/context/context.test.ts`
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { WorkspaceJail } from "../tools/jail.js";
import { readBootstrap } from "./bootstrap.js";
import { discoverSkills, loadSkill, skillsTools } from "./skills.js";
import {
  readDomainSkills,
  listDomains,
  domainSkillsTools,
} from "./domain-skills.js";

async function makeWorkspace(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-ts-ctx-"));
  return root;
}

test("bootstrap: reads named slots and skips missing files", async () => {
  const root = await makeWorkspace();
  await fs.writeFile(path.join(root, "SOUL.md"), "I am the cockpit assistant.\n");
  await fs.writeFile(path.join(root, "MEMORY.md"), "User prefers concise output.\n");
  // USER/AGENTS/TOOLS deliberately missing.
  const jail = new WorkspaceJail(root);

  const result = await readBootstrap(jail);
  assert.match(result.prefix, /Workspace context/);
  assert.match(result.prefix, /SOUL\.md/);
  assert.match(result.prefix, /cockpit assistant/);
  assert.match(result.prefix, /MEMORY\.md/);
  assert.match(result.prefix, /User prefers concise output/);
  assert.equal(result.loaded.length, 2);
  assert.equal(result.loaded[0].slot, "SOUL.md");
  assert.equal(result.loaded[1].slot, "MEMORY.md");
});

test("bootstrap: returns empty prefix when no slots exist", async () => {
  const root = await makeWorkspace();
  const jail = new WorkspaceJail(root);
  const result = await readBootstrap(jail);
  assert.equal(result.prefix, "");
  assert.deepEqual(result.loaded, []);
});

test("bootstrap: respects per-file budget", async () => {
  const root = await makeWorkspace();
  await fs.writeFile(path.join(root, "SOUL.md"), "x".repeat(500));
  const jail = new WorkspaceJail(root);
  const result = await readBootstrap(jail, { perFileBytes: 100, totalBytes: 1000 });
  assert.equal(result.loaded[0].truncated, true);
  assert.equal(result.loaded[0].bytes, 100);
});

test("skills: discovery + view tools work end-to-end", async () => {
  const root = await makeWorkspace();
  const skillDir = path.join(root, "skills", "writing", "haiku");
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(
    path.join(skillDir, "SKILL.md"),
    [
      "---",
      "name: haiku",
      "description: Write a 5-7-5 haiku.",
      "tags: [writing, poetry]",
      "---",
      "",
      "Compose a haiku in 5-7-5 syllables. Be evocative.",
      "",
    ].join("\n"),
  );
  const jail = new WorkspaceJail(root);

  const skills = await discoverSkills(jail);
  assert.equal(skills.length, 1);
  assert.equal(skills[0].name, "haiku");
  assert.equal(skills[0].description, "Write a 5-7-5 haiku.");
  assert.deepEqual(skills[0].tags, ["writing", "poetry"]);

  const full = await loadSkill(jail, "haiku");
  assert.ok(full);
  assert.match(full!.body, /5-7-5 syllables/);

  const tools = skillsTools(jail);
  const list = tools.find((t) => t.name === "skills_list")!;
  const listResult = await list.execute("call-1", {});
  assert.match(listResult.content[0].text, /haiku/);

  const view = tools.find((t) => t.name === "skill_view")!;
  const viewResult = await view.execute("call-2", { name: "haiku" });
  assert.match(viewResult.content[0].text, /Compose a haiku/);
});

test("skills: missing skills directory returns empty list", async () => {
  const root = await makeWorkspace();
  const jail = new WorkspaceJail(root);
  assert.deepEqual(await discoverSkills(jail), []);
  const tools = skillsTools(jail);
  const result = await tools.find((t) => t.name === "skills_list")!.execute("c", {});
  assert.match(result.content[0].text, /No skills installed/);
});

test("domain-skills: lookup by host and by URL", async () => {
  const root = await makeWorkspace();
  const dir = path.join(root, "domain-skills", "github.com");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "selectors.md"),
    "Use `[data-testid=...]` for stable selectors on GitHub.",
  );
  const jail = new WorkspaceJail(root);

  const domains = await listDomains(jail);
  assert.deepEqual(domains, ["github.com"]);

  const byHost = await readDomainSkills(jail, "github.com");
  assert.equal(byHost.host, "github.com");
  assert.equal(byHost.files.length, 1);
  assert.match(byHost.files[0].content, /data-testid/);

  const byUrl = await readDomainSkills(jail, "https://www.github.com/foo/bar");
  assert.equal(byUrl.host, "github.com");
  assert.equal(byUrl.files.length, 1);
});

test("domain-skills: tool returns hint when host is unknown", async () => {
  const root = await makeWorkspace();
  await fs.mkdir(path.join(root, "domain-skills", "example.com"), { recursive: true });
  await fs.writeFile(
    path.join(root, "domain-skills", "example.com", "x.md"),
    "hi",
  );
  const jail = new WorkspaceJail(root);
  const tool = domainSkillsTools(jail).find(
    (t) => t.name === "domain_skill_for_host",
  )!;
  const result = await tool.execute("c", { host: "unknown.test" });
  assert.match(result.content[0].text, /No domain skills/);
  assert.match(result.content[0].text, /example\.com/);
});

test("domain-skills: rejects path traversal in host argument", async () => {
  const root = await makeWorkspace();
  const jail = new WorkspaceJail(root);
  const tool = domainSkillsTools(jail).find(
    (t) => t.name === "domain_skill_for_host",
  )!;
  const result = await tool.execute("c", { host: "../etc" });
  // "../etc" → containsSlash check fails → host is null → not-parseable branch
  assert.match(result.content[0].text, /Could not parse host/);
});
