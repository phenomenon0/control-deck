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
    expect(s.push("Next ")).toEqual([]);
    expect(s.push("phrase, ")).toEqual(["Next phrase,"]);
    expect(s.flush()).toBeNull();
  });

  it("flushes a trailing incomplete phrase", () => {
    const s = createPhraseSplitter();
    s.push("nothing terminal here");
    expect(s.flush()).toBe("nothing terminal here");
  });

  it("handles multiple phrases in one chunk", () => {
    const s = createPhraseSplitter();
    expect(s.push("a. b! c? ")).toEqual(["a.", "b!", "c?"]);
  });
});
