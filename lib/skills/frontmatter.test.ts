/**
 * Frontmatter parser is small but load-bearing — every SKILL.md relies on it.
 * Tests cover the four value shapes (plain, quoted, array, number/bool).
 */

import { describe, expect, test } from "bun:test";
import { parseFrontmatter, serializeFrontmatter } from "./frontmatter";

describe("parseFrontmatter", () => {
  test("returns empty data when no block", () => {
    const { data, body } = parseFrontmatter("just a body");
    expect(data).toEqual({});
    expect(body).toBe("just a body");
  });

  test("parses basic key: value pairs", () => {
    const src = `---\nname: Test Skill\ndescription: Does things.\n---\nprompt body`;
    const { data, body } = parseFrontmatter(src);
    expect(data.name).toBe("Test Skill");
    expect(data.description).toBe("Does things.");
    expect(body).toBe("prompt body");
  });

  test("parses inline arrays", () => {
    const src = `---\ntags: [a, b, c]\ntools: ["web_search", "vector_search"]\n---\n`;
    const { data } = parseFrontmatter(src);
    expect(data.tags).toEqual(["a", "b", "c"]);
    expect(data.tools).toEqual(["web_search", "vector_search"]);
  });

  test("parses quoted strings, numbers, booleans", () => {
    const src = `---\ntitle: "Quoted: yes"\nversion: 0.2\nenabled: true\n---\n`;
    const { data } = parseFrontmatter(src);
    expect(data.title).toBe("Quoted: yes");
    expect(data.version).toBe(0.2);
    expect(data.enabled).toBe(true);
  });
});

describe("serializeFrontmatter", () => {
  test("round-trips a simple manifest", () => {
    const data = {
      name: "Test",
      description: "hi",
      tags: ["a", "b"],
      tools: ["web_search"],
    };
    const src = serializeFrontmatter(data, "\nbody\n");
    const parsed = parseFrontmatter(src);
    expect(parsed.data.name).toBe("Test");
    expect(parsed.data.tags).toEqual(["a", "b"]);
    expect(parsed.body.trim()).toBe("body");
  });
});
