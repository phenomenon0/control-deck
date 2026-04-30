import { describe, expect, it } from "bun:test";

import { isNoiseTranscript } from "./noise-filter";

describe("isNoiseTranscript", () => {
  it("drops empty / whitespace-only transcripts", () => {
    expect(isNoiseTranscript("")).toBe(true);
    expect(isNoiseTranscript("   ")).toBe(true);
    expect(isNoiseTranscript("\n\t")).toBe(true);
  });

  it("drops single-character transcripts", () => {
    expect(isNoiseTranscript("a")).toBe(true);
    expect(isNoiseTranscript("I")).toBe(true);
    expect(isNoiseTranscript(".")).toBe(true);
  });

  it("drops repeated-character noise (aaaa, mmm)", () => {
    expect(isNoiseTranscript("aaaa")).toBe(true);
    expect(isNoiseTranscript("mmm")).toBe(true);
    expect(isNoiseTranscript("oooo")).toBe(true);
  });

  it("drops standalone filler tokens", () => {
    expect(isNoiseTranscript("you")).toBe(true);
    expect(isNoiseTranscript("uh")).toBe(true);
    expect(isNoiseTranscript("hmm")).toBe(true);
    expect(isNoiseTranscript("the")).toBe(true);
    expect(isNoiseTranscript("OK")).toBe(true);
  });

  it("drops standalone fillers with trailing punctuation", () => {
    expect(isNoiseTranscript("you.")).toBe(true);
    expect(isNoiseTranscript("uh,")).toBe(true);
    expect(isNoiseTranscript("hmm?")).toBe(true);
  });

  it("drops short two-word noise pairs (uh um, the the)", () => {
    expect(isNoiseTranscript("uh um")).toBe(true);
    expect(isNoiseTranscript("the the")).toBe(true);
    expect(isNoiseTranscript("yeah ok")).toBe(true);
  });

  it("keeps real two-word phrases", () => {
    // "yes please" — "yes" is in noise set but "please" is not, so the
    // pair survives.
    expect(isNoiseTranscript("yes please")).toBe(false);
    expect(isNoiseTranscript("the dog")).toBe(false);
    expect(isNoiseTranscript("hello world")).toBe(false);
  });

  it("keeps real questions and statements", () => {
    expect(isNoiseTranscript("what time is it")).toBe(false);
    expect(isNoiseTranscript("summarize the article")).toBe(false);
    expect(isNoiseTranscript("Hi there.")).toBe(false);
    // Three-word phrase with noise-only tokens still passes — the rule
    // is intentionally narrow to avoid false positives on real speech.
    expect(isNoiseTranscript("uh oh okay")).toBe(false);
  });

  it("keeps single non-noise words (a name, a command)", () => {
    expect(isNoiseTranscript("Stop")).toBe(false);
    expect(isNoiseTranscript("Continue")).toBe(false);
    expect(isNoiseTranscript("Submit")).toBe(false);
  });
});
