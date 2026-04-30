/**
 * Drive the pure newsroom doc reducer with scripted final transcripts. No
 * voice-core, no React — just `applyTranscriptToDoc`. This is the fast,
 * deterministic regression net for the doc-mutation logic that lives behind
 * the streaming voice path.
 */

import { describe, expect, test } from "bun:test";

import {
  applyDocAction,
  applyTranscriptToDoc,
  detectCommand,
  type DocAction,
  type DocBlock,
  type DocState,
} from "@/components/voice-newsroom/newsroom-doc";

function emptyState(): DocState {
  return { headline: "", blocks: [], log: [], artifacts: [] };
}

function scriptedClock() {
  let t = 1_700_000_000_000;
  return () => (t += 1);
}

function scriptedRand() {
  let i = 0;
  return () => {
    i++;
    return (i * 0.123456) % 1;
  };
}

function applyMany(initial: DocState, transcripts: string[]): DocState {
  const opts = { now: scriptedClock(), rand: scriptedRand() };
  let state = initial;
  for (const t of transcripts) {
    state = applyTranscriptToDoc(state, t, opts);
  }
  return state;
}

describe("detectCommand", () => {
  test("matches all canonical voice commands", () => {
    expect(detectCommand("new paragraph")?.kind).toBe("newParagraph");
    expect(detectCommand("make that a heading")?.kind).toBe("makeHeading");
    expect(detectCommand("pull quote")?.kind).toBe("pullQuote");
    expect(detectCommand("tighten this")?.kind).toBe("tighten");
    expect(detectCommand("scratch that")?.kind).toBe("scratch");
    expect(detectCommand("add photo of a sunset over mountains")?.kind).toBe("addPhoto");
    expect(detectCommand("change title to The big story")?.kind).toBe("changeTitle");
  });

  test("non-commands return null", () => {
    expect(detectCommand("hello world")).toBeNull();
    expect(detectCommand("the quick brown fox")).toBeNull();
    expect(detectCommand("")).toBeNull();
  });

  // Whisper polish adds capitalization + trailing punctuation, so detection
  // must be tolerant of that or every voice command silently no-ops.
  test("matches commands with whisper-style trailing punctuation", () => {
    expect(detectCommand("Make that a heading.")?.kind).toBe("makeHeading");
    expect(detectCommand("Pull quote.")?.kind).toBe("pullQuote");
    expect(detectCommand("Scratch that!")?.kind).toBe("scratch");
    expect(detectCommand("New paragraph,")?.kind).toBe("newParagraph");
    expect(detectCommand("Tighten this?")?.kind).toBe("tighten");
  });

  test("changeTitle preserves the new-title casing", () => {
    const cmd = detectCommand("Change title to The Big Story.");
    expect(cmd?.kind).toBe("changeTitle");
    if (cmd?.kind === "changeTitle") expect(cmd.text).toBe("The Big Story");
  });
});

describe("applyTranscriptToDoc", () => {
  test("plain transcript appends a paragraph block", () => {
    const next = applyTranscriptToDoc(emptyState(), "the rain in spain falls mainly on the plain", {
      now: scriptedClock(),
      rand: scriptedRand(),
    });
    expect(next.blocks.length).toBe(1);
    expect(next.blocks[0].kind).toBe("p");
    expect(next.blocks[0].text).toBe("the rain in spain falls mainly on the plain");
  });

  test("first transcript also infers a headline", () => {
    const next = applyTranscriptToDoc(emptyState(), "After early nightfall the yellow lamps would light up.", {
      now: scriptedClock(),
      rand: scriptedRand(),
    });
    expect(next.headline.length).toBeGreaterThan(0);
    expect(next.headline.toLowerCase()).toContain("after early nightfall");
  });

  test("'pull quote' converts last paragraph to a blockquote", () => {
    const state = applyMany(emptyState(), ["nothing matters except this", "pull quote"]);
    const last = state.blocks[state.blocks.length - 1];
    expect(last.kind).toBe("quote");
    expect(last.text).toBe("nothing matters except this");
    expect(last.ai?.kind).toBe("Voice · quote");
  });

  test("'make that a heading' promotes last paragraph to h2", () => {
    const state = applyMany(emptyState(), ["the year is 2026", "make that a heading"]);
    const last = state.blocks[state.blocks.length - 1];
    expect(last.kind).toBe("h2");
  });

  test("'scratch that' removes the last block", () => {
    const state = applyMany(emptyState(), ["first", "second", "scratch that"]);
    expect(state.blocks.length).toBe(1);
    expect(state.blocks[0].text).toBe("first");
  });

  test("'tighten this' strips filler from last block", () => {
    const state = applyMany(emptyState(), ["this is really very actually just basic stuff", "tighten this"]);
    const last = state.blocks[state.blocks.length - 1];
    expect(last.text).toBe("this is basic stuff");
  });

  test("'add photo of X' adds an image block + artifact", () => {
    const state = applyMany(emptyState(), ["the dog ran across the field", "add photo of a golden retriever in tall grass"]);
    const last = state.blocks[state.blocks.length - 1];
    expect(last.kind).toBe("embed");
    expect(last.embedKind).toBe("image");
    expect(state.artifacts.length).toBe(1);
    expect(state.artifacts[0].title).toBe("a golden retriever in tall grass");
  });

  test("'change title to ...' overwrites headline without adding a block", () => {
    const state = applyMany(emptyState(), ["change title to The Big Story"]);
    expect(state.headline).toBe("The Big Story");
    expect(state.blocks.length).toBe(0);
  });

  test("ten transcripts in order produce ten ordered blocks", () => {
    const transcripts = Array.from({ length: 10 }, (_, i) => `paragraph number ${i}`);
    const state = applyMany(emptyState(), transcripts);
    expect(state.blocks.length).toBe(10);
    expect(state.blocks.map((b) => b.text)).toEqual(transcripts);
    expect(state.blocks.every((b) => b.kind === "p")).toBe(true);
  });

  test("empty/whitespace transcripts are no-ops", () => {
    const state = applyMany(emptyState(), ["", "   ", "\n\t"]);
    expect(state.blocks.length).toBe(0);
    expect(state.headline).toBe("");
  });

  test("decision log accumulates one entry per non-empty mutation", () => {
    const state = applyMany(emptyState(), ["first", "second", "third"]);
    // 3 paragraphs + 1 inferred headline = 4 log entries
    expect(state.log.length).toBe(4);
    expect(state.log[state.log.length - 1].text).toContain("third");
  });

  test("repeating the same sentence across turns produces two blocks", () => {
    // Mirrors the React component: between turns, transcriptFinal goes empty
    // and lastTakenRef resets. So the second utterance of identical text
    // still produces a fresh block — important for a user who naturally
    // repeats themselves.
    const state = applyMany(emptyState(), ["nothing matters", "nothing matters"]);
    expect(state.blocks.length).toBe(2);
    expect(state.blocks[0].text).toBe("nothing matters");
    expect(state.blocks[1].text).toBe("nothing matters");
  });

  test("voice-command after a paragraph mutates that paragraph in place", () => {
    // The full flow: speak a sentence → say "make that a heading." → the last
    // block should switch from a <p> to an <h2> WITHOUT the previous text
    // disappearing. Punctuation comes from the whisper-correction layer.
    const state = applyMany(emptyState(), [
      "the year is twenty twenty six",
      "Make that a heading.",
    ]);
    expect(state.blocks.length).toBe(1);
    expect(state.blocks[0].kind).toBe("h2");
    expect(state.blocks[0].text).toBe("the year is twenty twenty six");
  });

  test("scratch + replace flow: user fixes a sentence with a redo", () => {
    const state = applyMany(emptyState(), [
      "this is the wrong sentence",
      "Scratch that.",
      "this is the right sentence",
    ]);
    expect(state.blocks.length).toBe(1);
    expect(state.blocks[0].text).toBe("this is the right sentence");
  });
});

describe("applyDocAction", () => {
  function withBlocks(): { state: DocState; ids: string[] } {
    const a = applyMany(emptyState(), ["alpha sentence", "beta sentence", "gamma sentence"]);
    return { state: a, ids: a.blocks.map((b) => b.id) };
  }

  function dispatch(state: DocState, action: DocAction): DocState {
    return applyDocAction(state, action, { now: scriptedClock(), rand: scriptedRand() });
  }

  test("EDIT_BLOCK_TEXT changes the target block's text", () => {
    const { state, ids } = withBlocks();
    const next = dispatch(state, { type: "EDIT_BLOCK_TEXT", blockId: ids[1], text: "beta replaced" });
    expect(next.blocks[1].text).toBe("beta replaced");
    expect(next.blocks[0].text).toBe("alpha sentence");
    expect(next.blocks[2].text).toBe("gamma sentence");
  });

  test("SET_BLOCK_KIND switches a paragraph to h1/h2/h3/quote/code", () => {
    const { state, ids } = withBlocks();
    let s = state;
    s = dispatch(s, { type: "SET_BLOCK_KIND", blockId: ids[0], kind: "h1" });
    expect(s.blocks[0].kind).toBe("h1");
    s = dispatch(s, { type: "SET_BLOCK_KIND", blockId: ids[1], kind: "code" });
    expect(s.blocks[1].kind).toBe("code");
    s = dispatch(s, { type: "SET_BLOCK_KIND", blockId: ids[2], kind: "quote" });
    expect(s.blocks[2].kind).toBe("quote");
  });

  test("DELETE_BLOCK removes only the target", () => {
    const { state, ids } = withBlocks();
    const next = dispatch(state, { type: "DELETE_BLOCK", blockId: ids[1] });
    expect(next.blocks.length).toBe(2);
    expect(next.blocks.map((b) => b.text)).toEqual(["alpha sentence", "gamma sentence"]);
  });

  test("MOVE_BLOCK up/down reorders without changing other blocks", () => {
    const { state, ids } = withBlocks();
    const up = dispatch(state, { type: "MOVE_BLOCK", blockId: ids[1], direction: "up" });
    expect(up.blocks.map((b) => b.text)).toEqual(["beta sentence", "alpha sentence", "gamma sentence"]);
    const down = dispatch(state, { type: "MOVE_BLOCK", blockId: ids[1], direction: "down" });
    expect(down.blocks.map((b) => b.text)).toEqual(["alpha sentence", "gamma sentence", "beta sentence"]);
  });

  test("MOVE_BLOCK at edges is a no-op (no array out-of-bounds)", () => {
    const { state, ids } = withBlocks();
    const upTop = dispatch(state, { type: "MOVE_BLOCK", blockId: ids[0], direction: "up" });
    expect(upTop.blocks).toEqual(state.blocks);
    const downBottom = dispatch(state, { type: "MOVE_BLOCK", blockId: ids[2], direction: "down" });
    expect(downBottom.blocks).toEqual(state.blocks);
  });

  test("INSERT_IMAGE_BLOCK appends an embed + an artifact", () => {
    const { state } = withBlocks();
    const next = dispatch(state, { type: "INSERT_IMAGE_BLOCK", src: "data:image/png;base64,...", alt: "test photo" });
    const last = next.blocks[next.blocks.length - 1] as DocBlock;
    expect(last.kind).toBe("embed");
    expect(last.embedKind).toBe("image");
    expect(last.embedSrc).toBe("data:image/png;base64,...");
    expect(last.embedAlt).toBe("test photo");
    expect(next.artifacts.length).toBe(state.artifacts.length + 1);
  });

  test("REWRITE_BLOCK swaps text and tags the AI source", () => {
    const { state, ids } = withBlocks();
    const next = dispatch(state, {
      type: "REWRITE_BLOCK",
      blockId: ids[1],
      text: "beta tightened",
      aiKind: "AI · tighten",
      aiNote: "Reduced filler.",
    });
    expect(next.blocks[1].text).toBe("beta tightened");
    expect(next.blocks[1].ai?.kind).toBe("AI · tighten");
  });

  test("SET_HEADLINE replaces the headline only", () => {
    const { state } = withBlocks();
    const next = dispatch(state, { type: "SET_HEADLINE", text: "A different title" });
    expect(next.headline).toBe("A different title");
    expect(next.blocks).toEqual(state.blocks);
  });

  test("unknown blockId is a no-op", () => {
    const { state } = withBlocks();
    const ops: DocAction[] = [
      { type: "EDIT_BLOCK_TEXT", blockId: "nope", text: "x" },
      { type: "SET_BLOCK_KIND", blockId: "nope", kind: "h2" },
      { type: "DELETE_BLOCK", blockId: "nope" },
      { type: "MOVE_BLOCK", blockId: "nope", direction: "up" },
      { type: "REWRITE_BLOCK", blockId: "nope", text: "x", aiKind: "k", aiNote: "n" },
    ];
    for (const a of ops) {
      const next = dispatch(state, a);
      expect(next.blocks).toEqual(state.blocks);
    }
  });
});
