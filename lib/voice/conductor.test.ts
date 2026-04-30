import { describe, expect, it } from "bun:test";

import {
  cleanResponseForDisplay,
  cleanResponseForSpeech,
  createPhraseSplitter,
  getToolStartMessage,
  PHRASE_ENDINGS,
} from "./conductor";

describe("cleanResponseForDisplay", () => {
  it("strips JSON tool payloads", () => {
    const input = `Sure! {"tool":"web_search","args":{"q":"x"}} done.`;
    expect(cleanResponseForDisplay(input)).toBe("Sure!  done.");
  });

  it("strips fenced JSON tool blocks", () => {
    const input = "before\n```json\n{\"tool\":\"x\",\"args\":{}}\n```\nafter";
    expect(cleanResponseForDisplay(input)).toContain("before");
    expect(cleanResponseForDisplay(input)).toContain("after");
    expect(cleanResponseForDisplay(input)).not.toContain("tool");
  });

  it("strips inline executing markers and image markdown", () => {
    const input = "[Executing web_search...]\nHere ![alt](http://x/y.png) is data.";
    expect(cleanResponseForDisplay(input)).toBe("Here  is data.");
  });
});

describe("cleanResponseForSpeech", () => {
  it("strips markdown formatting", () => {
    expect(cleanResponseForSpeech("**bold** and *italic*")).toBe("bold and italic");
  });

  it("collapses fenced code to a literal phrase", () => {
    expect(cleanResponseForSpeech("look at ```ts\nfoo()\n```")).toContain("code block");
  });

  it("returns empty for whitespace-only input", () => {
    expect(cleanResponseForSpeech("   ")).toBe("");
  });

  it("clamps to maxChars", () => {
    const long = "a".repeat(2000);
    expect(cleanResponseForSpeech(long, 100).length).toBe(100);
  });
});

describe("getToolStartMessage", () => {
  it("returns a message for known tools", () => {
    expect(getToolStartMessage("web_search")).toBe("Searching the web...");
  });
  it("returns null for unknown tools", () => {
    expect(getToolStartMessage("totally_unknown")).toBeNull();
  });
});

describe("PHRASE_ENDINGS", () => {
  it("matches sentence terminators", () => {
    expect("Hello world. ".match(PHRASE_ENDINGS)?.[0]).toBe(". ");
  });
  it("matches commas as a phrase break", () => {
    expect("first, second".match(PHRASE_ENDINGS)?.[0]).toBe(", ");
  });
});

describe("createPhraseSplitter", () => {
  it("emits whole phrases as they complete and keeps the tail", () => {
    const s = createPhraseSplitter();
    expect(s.push("Hello world. ")).toEqual(["Hello world."]);
    // Short comma-led clause stays buffered (below MIN_SOFT_SPLIT_CHARS).
    expect(s.push("Next ")).toEqual([]);
    expect(s.push("phrase, ")).toEqual([]);
    // Adding more text still doesn't split — combined "Next phrase, " is
    // 13 chars before the comma, well under the soft threshold.
    expect(s.push("done. ")).toEqual(["Next phrase, done."]);
    expect(s.flush()).toBeNull();
  });

  it("flushes a trailing incomplete phrase", () => {
    const s = createPhraseSplitter();
    s.push("nothing terminal here");
    expect(s.flush()).toBe("nothing terminal here");
  });

  it("handles multiple sentence-ending phrases in one chunk", () => {
    const s = createPhraseSplitter();
    // "a." — after "a" the period is at idx 1 with no preceding letter
    // sequence, so it falls through abbreviation checks and splits.
    // (Single lowercase letter+period doesn't match the initial-cap rule.)
    expect(s.push("a. b! c? ")).toEqual(["a.", "b!", "c?"]);
  });

  it("does NOT split on abbreviations (Dr., Mr., etc., e.g.)", () => {
    const s = createPhraseSplitter();
    expect(s.push("Dr. Smith said hello. ")).toEqual(["Dr. Smith said hello."]);
    expect(s.push("e.g. this is fine. ")).toEqual(["e.g. this is fine."]);
    expect(s.push("Items, etc. are listed. ")).toEqual(["Items, etc. are listed."]);
  });

  it("does NOT split on decimal numbers (3.14, v2.0)", () => {
    const s = createPhraseSplitter();
    expect(s.push("Pi is roughly 3.14 give or take. ")).toEqual([
      "Pi is roughly 3.14 give or take.",
    ]);
    s.flush();
    expect(s.push("v2.0 is the version. ")).toEqual(["v2.0 is the version."]);
  });

  it("does NOT split on multi-letter dot patterns (U.S., a.m.)", () => {
    const s = createPhraseSplitter();
    expect(s.push("U.S. policy is clear. ")).toEqual(["U.S. policy is clear."]);
    s.flush();
    expect(s.push("Meeting at 9 a.m. tomorrow. ")).toEqual([
      "Meeting at 9 a.m. tomorrow.",
    ]);
  });

  it("does NOT split short leading clauses on commas (First,)", () => {
    const s = createPhraseSplitter();
    expect(s.push("First, the answer is straightforward. ")).toEqual([
      "First, the answer is straightforward.",
    ]);
  });

  it("DOES split on commas after a long enough phrase", () => {
    const s = createPhraseSplitter();
    // "I think we should consider this carefully" is > 25 chars before the
    // comma, so it splits to start TTS earlier.
    expect(
      s.push("I think we should consider this carefully, before deciding. "),
    ).toEqual([
      "I think we should consider this carefully,",
      "before deciding.",
    ]);
  });
});
