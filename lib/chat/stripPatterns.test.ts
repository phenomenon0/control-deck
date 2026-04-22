import { describe, expect, test } from "bun:test";
import { stripForDisplay, stripForLLMHistory } from "./stripPatterns";

describe("stripForDisplay", () => {
  test("removes fenced tool JSON", () => {
    const input = 'Thinking...\n```json\n{"tool":"generate_image","args":{"prompt":"cat"}}\n```\n\nHere you go.';
    const out = stripForDisplay(input);
    expect(out).not.toContain('"tool"');
    expect(out).toContain("Thinking...");
    expect(out).toContain("Here you go.");
  });

  test("removes inline tool JSON", () => {
    const input = 'The model output {"tool":"foo","args":{"x":1}} in the middle.';
    const out = stripForDisplay(input);
    expect(out).not.toContain("tool");
    expect(out).toMatch(/The model output +in the middle\./);
  });

  test("removes markdown image syntax", () => {
    const out = stripForDisplay("Before ![caption](http://example.com/x.png) after");
    expect(out).toBe("Before  after");
  });

  test("removes [Executing ...] progress markers", () => {
    const out = stripForDisplay("Intro\n[Executing tool call...]\nBody");
    expect(out).toContain("Intro");
    expect(out).not.toContain("Executing");
    expect(out).toContain("Body");
  });

  test("collapses triple newlines left by strips", () => {
    const input = "a\n\n\n\nb";
    const out = stripForDisplay(input);
    expect(out).toBe("a\n\nb");
  });

  test("trims leading/trailing whitespace", () => {
    expect(stripForDisplay("   hello\n\n  ")).toBe("hello");
  });

  test("removes 'Output:' and 'Errors:' code-fence blocks from execution", () => {
    const input = "All good.\nOutput:\n```\nhello stdout\n```\nStill fine.";
    const out = stripForDisplay(input);
    expect(out).not.toContain("hello stdout");
    expect(out).not.toContain("Output:");
    expect(out).toContain("All good.");
    expect(out).toContain("Still fine.");
  });

  test("regex lastIndex is reset between invocations (fresh regex per call)", () => {
    // Bug pattern: global regexes share lastIndex. The impl builds a
    // new RegExp each call to avoid that. Two calls must give the same
    // result.
    const input = "![a](b.png) text ![c](d.png) more";
    expect(stripForDisplay(input)).toBe(stripForDisplay(input));
  });

  test("empty input returns empty string", () => {
    expect(stripForDisplay("")).toBe("");
  });

  test("plain text is unchanged", () => {
    expect(stripForDisplay("Just a sentence.")).toBe("Just a sentence.");
  });
});

describe("stripForLLMHistory", () => {
  test("removes markdown images that would teach the LLM to fake artifacts", () => {
    const out = stripForLLMHistory("![](http://x/y.png)\nSome text");
    expect(out).not.toContain("![]");
    expect(out).toContain("Some text");
  });

  test("removes fake-success phrases", () => {
    const out = stripForLLMHistory("Here is the image you requested. Also, prices are up.");
    expect(out).not.toContain("Here is the image");
    expect(out).toContain("Also, prices are up.");
  });

  test("removes artifact IDs like img_<n>-<n> / audio_<n>-<n>", () => {
    const out = stripForLLMHistory("Saved as img_2026-42 and audio_17-9");
    expect(out).not.toMatch(/img_\d+-\d+/);
    expect(out).not.toMatch(/audio_\d+-\d+/);
  });

  test("removes orphan file refs in parens", () => {
    const out = stripForLLMHistory("Output (thing.png) was good");
    expect(out).not.toContain("thing.png");
    expect(out).toContain("Output");
  });

  test("does NOT strip tool JSON blocks — those may need to round-trip to history", () => {
    const input = '```json\n{"tool":"foo","args":{}}\n```';
    expect(stripForLLMHistory(input)).toContain("tool");
  });

  test("preserves plain assistant replies untouched", () => {
    const input = "Sure, I can help with that question.";
    expect(stripForLLMHistory(input)).toBe(input);
  });

  test("idempotent — running twice gives the same output", () => {
    const input = "![](x.png) Here is an image named img_01-abc (foo.png)";
    const once = stripForLLMHistory(input);
    expect(stripForLLMHistory(once)).toBe(once);
  });
});
