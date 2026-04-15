/**
 * GLYPH Codec Tests
 * Run with: bun test lib/codec/glyph.test.ts
 */

import { test, expect, describe } from "bun:test";
import { encodeGlyph, decodeGlyph, encodeGlyphSmart, wrapGlyphBlock } from "./index";

describe("scalars", () => {
  test("null encodes to ∅", () => {
    expect(encodeGlyph(null)).toBe("∅");
    expect(decodeGlyph("∅")).toBe(null);
  });

  test("booleans encode to t/f", () => {
    expect(encodeGlyph(true)).toBe("t");
    expect(encodeGlyph(false)).toBe("f");
    expect(decodeGlyph("t")).toBe(true);
    expect(decodeGlyph("f")).toBe(false);
  });

  test("integers encode bare", () => {
    expect(encodeGlyph(0)).toBe("0");
    expect(encodeGlyph(42)).toBe("42");
    expect(encodeGlyph(-100)).toBe("-100");
    expect(decodeGlyph("42")).toBe(42);
    expect(decodeGlyph("-100")).toBe(-100);
  });

  test("floats encode bare", () => {
    expect(encodeGlyph(3.14)).toBe("3.14");
    expect(encodeGlyph(1e10)).toBe("10000000000");
    expect(decodeGlyph("3.14")).toBe(3.14);
  });

  test("simple strings encode bare", () => {
    expect(encodeGlyph("hello")).toBe("hello");
    expect(encodeGlyph("foo_bar")).toBe("foo_bar");
    expect(encodeGlyph("path/to/file")).toBe("path/to/file");
    expect(decodeGlyph("hello")).toBe("hello");
  });

  test("complex strings are quoted", () => {
    expect(encodeGlyph("hello world")).toBe('"hello world"');
    expect(encodeGlyph("has\nnewline")).toBe('"has\\nnewline"');
    expect(encodeGlyph('has"quote')).toBe('"has\\"quote"');
    expect(decodeGlyph('"hello world"')).toBe("hello world");
    expect(decodeGlyph('"has\\nnewline"')).toBe("has\nnewline");
  });

  test("empty string is quoted", () => {
    expect(encodeGlyph("")).toBe('""');
    expect(decodeGlyph('""')).toBe("");
  });
});

describe("reserved words", () => {
  test("t/f as strings are quoted", () => {
    expect(encodeGlyph("t")).toBe('"t"');
    expect(encodeGlyph("f")).toBe('"f"');
    expect(decodeGlyph('"t"')).toBe("t");
    expect(decodeGlyph('"f"')).toBe("f");
  });

  test("true/false as strings are quoted", () => {
    expect(encodeGlyph("true")).toBe('"true"');
    expect(encodeGlyph("false")).toBe('"false"');
  });

  test("null as string is quoted", () => {
    expect(encodeGlyph("null")).toBe('"null"');
    expect(decodeGlyph('"null"')).toBe("null");
  });

  test("∅ as string is quoted", () => {
    expect(encodeGlyph("∅")).toBe('"∅"');
  });
});

describe("arrays", () => {
  test("empty array", () => {
    expect(encodeGlyph([])).toBe("[]");
    expect(decodeGlyph("[]")).toEqual([]);
  });

  test("simple array", () => {
    const arr = [1, 2, 3];
    const glyph = encodeGlyph(arr);
    expect(glyph).toBe("[1 2 3]");
    expect(decodeGlyph(glyph)).toEqual(arr);
  });

  test("mixed array", () => {
    const arr = [null, true, 42, "hello"];
    const glyph = encodeGlyph(arr);
    expect(glyph).toBe("[∅ t 42 hello]");
    expect(decodeGlyph(glyph)).toEqual(arr);
  });

  test("nested array", () => {
    const arr = [[1, 2], [3, 4]];
    const glyph = encodeGlyph(arr);
    expect(glyph).toBe("[[1 2] [3 4]]");
    expect(decodeGlyph(glyph)).toEqual(arr);
  });
});

describe("objects", () => {
  test("empty object", () => {
    expect(encodeGlyph({})).toBe("@[]()");
    expect(decodeGlyph("@[]()")).toEqual({});
  });

  test("simple object", () => {
    const obj = { name: "Alice", age: 30 };
    const glyph = encodeGlyph(obj);
    expect(glyph).toBe("@[name age](Alice 30)");
    expect(decodeGlyph(glyph)).toEqual(obj);
  });

  test("object with various types", () => {
    const obj = { active: true, count: 5, label: null };
    const glyph = encodeGlyph(obj);
    expect(glyph).toContain("@[");
    const decoded = decodeGlyph(glyph);
    expect(decoded).toEqual(obj);
  });

  test("nested object", () => {
    const obj = { user: { name: "Bob", id: 1 } };
    const glyph = encodeGlyph(obj);
    expect(glyph).toContain("@[name id]");
    expect(decodeGlyph(glyph)).toEqual(obj);
  });

  test("object with quoted keys", () => {
    const obj = { "has space": 1, "@special": 2 };
    const glyph = encodeGlyph(obj);
    expect(glyph).toContain('"has space"');
    expect(glyph).toContain('"@special"');
    expect(decodeGlyph(glyph)).toEqual(obj);
  });
});

describe("tabular", () => {
  test("uniform array uses tabular (minRows=4)", () => {
    const arr = [
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
      { id: 3, name: "Charlie" },
      { id: 4, name: "Diana" },
    ];
    const glyph = encodeGlyph(arr, { autoTabular: true, minRows: 4 });
    expect(glyph).toContain("@tab");
    expect(glyph).toContain("@end");
    expect(decodeGlyph(glyph)).toEqual(arr);
  });

  test("non-uniform array does not use tabular", () => {
    const arr = [
      { a: 1 },
      { b: 2 },
      { c: 3 },
      { d: 4 },
    ];
    const glyph = encodeGlyph(arr, { autoTabular: true, minRows: 4 });
    expect(glyph).not.toContain("@tab");
  });

  test("array with nested objects does not use tabular", () => {
    const arr = [
      { id: 1, meta: { x: 1 } },
      { id: 2, meta: { x: 2 } },
      { id: 3, meta: { x: 3 } },
      { id: 4, meta: { x: 4 } },
    ];
    const glyph = encodeGlyph(arr, { autoTabular: true, minRows: 4 });
    expect(glyph).not.toContain("@tab");
  });

  test("tabular with null values", () => {
    const arr = [
      { id: 1, name: "Alice" },
      { id: 2, name: null },
      { id: 3, name: "Charlie" },
      { id: 4, name: "Diana" },
    ];
    const glyph = encodeGlyph(arr, { autoTabular: true, minRows: 4 });
    expect(glyph).toContain("@tab");
    expect(glyph).toContain("∅");
    expect(decodeGlyph(glyph)).toEqual(arr);
  });

  test("tabular with booleans", () => {
    const arr = [
      { id: 1, active: true },
      { id: 2, active: false },
      { id: 3, active: true },
      { id: 4, active: false },
    ];
    const glyph = encodeGlyph(arr, { autoTabular: true, minRows: 4 });
    expect(glyph).toContain("@tab");
    expect(decodeGlyph(glyph)).toEqual(arr);
  });

  test("autoTabular false disables tabular", () => {
    const arr = [
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
      { id: 3, name: "Charlie" },
      { id: 4, name: "Diana" },
    ];
    const glyph = encodeGlyph(arr, { autoTabular: false });
    expect(glyph).not.toContain("@tab");
    expect(glyph).toContain("@[");
  });
});

describe("encodeGlyphSmart", () => {
  test("returns savings percentage", () => {
    const data = Array(10).fill(null).map((_, i) => ({ id: i, val: i * 2 }));
    const result = encodeGlyphSmart(data);
    expect(result.jsonBytes).toBeGreaterThan(0);
    expect(result.glyphBytes).toBeGreaterThan(0);
    expect(result.savings).toBeGreaterThan(0);
    expect(typeof result.usedTabular).toBe("boolean");
  });

  test("picks shorter encoding for large payloads", () => {
    const data = Array(100).fill(null).map((_, i) => ({ id: i, value: i * 2 }));
    const result = encodeGlyphSmart(data);
    expect(result.glyphBytes).toBeLessThan(result.jsonBytes);
    expect(result.savings).toBeGreaterThan(20);
  });

  test("round-trip works", () => {
    const data = { users: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }] };
    const result = encodeGlyphSmart(data);
    expect(decodeGlyph(result.glyph)).toEqual(data);
  });
});

describe("wrapGlyphBlock", () => {
  test("wraps in fences", () => {
    const glyph = "@[a b](1 2)";
    const wrapped = wrapGlyphBlock(glyph);
    expect(wrapped).toBe("```glyph\n@[a b](1 2)\n```");
  });

  test("includes label", () => {
    const glyph = "@[a b](1 2)";
    const wrapped = wrapGlyphBlock(glyph, "tools");
    expect(wrapped).toBe("```glyph tools\n@[a b](1 2)\n```");
  });
});

describe("edge cases", () => {
  test("deeply nested structure", () => {
    const deep = { a: { b: { c: { d: { e: 1 } } } } };
    const glyph = encodeGlyph(deep);
    expect(decodeGlyph(glyph)).toEqual(deep);
  });

  test("unicode strings", () => {
    const obj = { emoji: "Hello!", japanese: "日本語" };
    const glyph = encodeGlyph(obj);
    expect(decodeGlyph(glyph)).toEqual(obj);
  });

  test("pipe character in string is escaped in tabular", () => {
    const arr = [
      { val: "a|b" },
      { val: "c|d" },
      { val: "e|f" },
      { val: "g|h" },
    ];
    const glyph = encodeGlyph(arr, { autoTabular: true, minRows: 4 });
    expect(glyph).toContain("\\|");
    expect(decodeGlyph(glyph)).toEqual(arr);
  });

  test("special characters in strings", () => {
    const special = { tab: "a\tb", newline: "a\nb", quote: 'a"b' };
    const glyph = encodeGlyph(special);
    expect(decodeGlyph(glyph)).toEqual(special);
  });

  test("array of primitives (not objects) stays as list", () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const glyph = encodeGlyph(arr, { autoTabular: true, minRows: 4 });
    expect(glyph).not.toContain("@tab");
    expect(glyph).toBe("[1 2 3 4 5 6 7 8 9 10]");
  });

  test("undefined treated as null", () => {
    const obj = { a: undefined };
    const glyph = encodeGlyph(obj);
    expect(glyph).toContain("∅");
  });
});

describe("real-world examples", () => {
  test("tool definitions", () => {
    const tools = [
      { name: "web_search", desc: "Search the web", params: ["query"] },
      { name: "generate_image", desc: "Generate images", params: ["prompt", "width"] },
      { name: "execute_code", desc: "Run code", params: ["language", "code"] },
      { name: "vector_search", desc: "Search vectors", params: ["query", "k"] },
    ];
    const result = encodeGlyphSmart(tools);
    expect(result.savings).toBeGreaterThan(10);
    expect(decodeGlyph(result.glyph)).toEqual(tools);
  });

  test("search results", () => {
    const results = [
      { title: "Result 1", url: "https://example.com/1", snippet: "First result" },
      { title: "Result 2", url: "https://example.com/2", snippet: "Second result" },
      { title: "Result 3", url: "https://example.com/3", snippet: "Third result" },
      { title: "Result 4", url: "https://example.com/4", snippet: "Fourth result" },
    ];
    const result = encodeGlyphSmart(results);
    expect(result.usedTabular).toBe(true);
    expect(decodeGlyph(result.glyph)).toEqual(results);
  });

  test("chatbot conversation (from earlier example)", () => {
    const conversation = {
      user_id: "usr_001",
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
        { role: "user", content: "How are you?" },
        { role: "assistant", content: "I'm doing well!" },
      ],
    };
    const glyph = encodeGlyph(conversation);
    expect(decodeGlyph(glyph)).toEqual(conversation);
  });
});
