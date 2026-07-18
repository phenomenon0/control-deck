/**
 * Tests for app/api/chat/_lib/prompt.ts — the pure prompt-join and the
 * voice-mode prompt resolution. assembleSystemPrompt itself is a thin
 * composition over DB/settings-backed renderers and is covered indirectly
 * by the route load smoke.
 */

import { describe, expect, test } from "bun:test";
import { AUDIO_MODES, promptForAudioMode } from "@/lib/audio/audio-modes";
import { joinPromptParts, voicePromptFor } from "./prompt";

describe("joinPromptParts", () => {
  test("joins blocks with a blank line", () => {
    expect(joinPromptParts(["a", "b", "c"])).toBe("a\n\nb\n\nc");
  });

  test("drops null, undefined, empty, and whitespace-only parts", () => {
    expect(joinPromptParts([null, "a", undefined, "", "   ", "b"])).toBe("a\n\nb");
  });

  test("returns an empty string when nothing survives", () => {
    expect(joinPromptParts([null, undefined, "", "  "])).toBe("");
    expect(joinPromptParts([])).toBe("");
  });

  test("keeps surviving parts verbatim (no trimming of content)", () => {
    expect(joinPromptParts(["  padded  "])).toBe("  padded  ");
  });
});

describe("voicePromptFor", () => {
  const base = {
    turnId: "t1",
    routeId: "r1",
    surface: "chat",
    source: "live",
    modality: "voice" as const,
  };

  test("returns null without voice metadata", () => {
    expect(voicePromptFor(undefined)).toBeNull();
  });

  test("returns null for a non-voice modality", () => {
    expect(voicePromptFor({ ...base, mode: "conversation", modality: "text" as never })).toBeNull();
  });

  test("returns null for an unknown mode", () => {
    expect(voicePromptFor({ ...base, mode: "bogus" })).toBeNull();
  });

  test("matches promptForAudioMode for every advertised mode", () => {
    for (const mode of AUDIO_MODES) {
      expect(voicePromptFor({ ...base, mode })).toBe(promptForAudioMode(mode));
    }
  });
});
