/**
 * Slot-binding runtime: bind / get / clear / list, plus correct isolation
 * between (modality, slotName) tuples.
 */

import { describe, test, expect, beforeEach } from "bun:test";

import {
  bindSlot,
  getSlot,
  listSlotsForModality,
  clearSlot,
  clearAllSlots,
} from "./runtime";
import type { SlotBinding } from "./types";

function binding(
  modality: SlotBinding["modality"],
  slotName: string,
  providerId: string,
): SlotBinding {
  return {
    modality,
    slotName,
    providerId,
    config: { providerId },
  };
}

describe("runtime", () => {
  beforeEach(() => clearAllSlots());

  test("bindSlot + getSlot round-trip", () => {
    bindSlot(binding("tts", "primary", "elevenlabs"));
    expect(getSlot("tts", "primary")?.providerId).toBe("elevenlabs");
  });

  test("getSlot returns undefined when nothing is bound", () => {
    expect(getSlot("video-gen", "primary")).toBeUndefined();
  });

  test("bindSlot overwrites on re-bind", () => {
    bindSlot(binding("tts", "primary", "voice-api"));
    bindSlot(binding("tts", "primary", "openai"));
    expect(getSlot("tts", "primary")?.providerId).toBe("openai");
  });

  test("different slotNames within a modality are isolated", () => {
    bindSlot(binding("text", "primary", "anthropic"));
    bindSlot(binding("text", "fast", "groq"));
    expect(getSlot("text", "primary")?.providerId).toBe("anthropic");
    expect(getSlot("text", "fast")?.providerId).toBe("groq");
  });

  test("listSlotsForModality only returns that modality's slots", () => {
    bindSlot(binding("text", "primary", "anthropic"));
    bindSlot(binding("text", "fast", "groq"));
    bindSlot(binding("tts", "primary", "elevenlabs"));
    const text = listSlotsForModality("text").map((b) => b.providerId).sort();
    expect(text).toEqual(["anthropic", "groq"]);
  });

  test("clearSlot removes only the targeted slot", () => {
    bindSlot(binding("text", "primary", "a"));
    bindSlot(binding("text", "fast", "b"));
    clearSlot("text", "primary");
    expect(getSlot("text", "primary")).toBeUndefined();
    expect(getSlot("text", "fast")?.providerId).toBe("b");
  });
});
