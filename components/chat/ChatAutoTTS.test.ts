import { describe, expect, test } from "bun:test";

import { shouldAutoSpeakReply } from "./ChatAutoTTS";
import { shouldRegisterVoiceReply } from "./ChatSubmitController";

// The auto-TTS readback lane was inert: nothing ever registered reply ids in
// voiceReplyMessageIdsRef, so the effect's `has(lastMsg.id)` gate was always
// false and only the voice-live streaming lane ever spoke. These tests pin
// both halves of the contract:
//   - registration (submit controller): only voice-origin turns without the
//     live streaming lane mark their assistant reply for full-text readback;
//   - gate (auto-TTS effect): speak exactly those registered replies, once,
//     after the run settles — never history, typed replies, or live turns.

describe("shouldRegisterVoiceReply", () => {
  test("voice-dictation turns register for full-text readback", () => {
    expect(shouldRegisterVoiceReply("voice-dictation")).toBe(true);
  });

  test("voice-live turns do not register — the streaming lane owns their speech", () => {
    // Registering live turns would double-speak: onSubmit already streams
    // phrase audio from SSE deltas (and has its own fallback readback).
    expect(shouldRegisterVoiceReply("voice-live")).toBe(false);
  });

  test("typed turns stay silent", () => {
    expect(shouldRegisterVoiceReply("typed")).toBe(false);
  });
});

describe("shouldAutoSpeakReply", () => {
  const assistantMsg = { id: "a1", role: "assistant" as const, content: "Hello there." };
  const base = {
    voiceEnabled: true,
    isRunning: false,
    lastMessage: assistantMsg as { id: string; role: "user" | "assistant"; content: string } | undefined,
    registeredIds: new Set(["a1"]),
    lastSpokenId: null as string | null,
  };

  test("registered assistant reply speaks once the run has settled", () => {
    expect(shouldAutoSpeakReply(base)).toBe(true);
  });

  test("unregistered message stays silent — opening voice mode must not read history or typed replies", () => {
    expect(shouldAutoSpeakReply({ ...base, registeredIds: new Set() })).toBe(false);
  });

  test("no speech while the run is still in flight", () => {
    expect(shouldAutoSpeakReply({ ...base, isRunning: true })).toBe(false);
  });

  test("no speech when voice is disabled", () => {
    expect(shouldAutoSpeakReply({ ...base, voiceEnabled: false })).toBe(false);
  });

  test("non-assistant last message stays silent", () => {
    expect(
      shouldAutoSpeakReply({ ...base, lastMessage: { id: "a1", role: "user", content: "hi" } }),
    ).toBe(false);
  });

  test("empty assistant content stays silent", () => {
    expect(
      shouldAutoSpeakReply({ ...base, lastMessage: { id: "a1", role: "assistant", content: "" } }),
    ).toBe(false);
  });

  test("already-spoken reply is not repeated", () => {
    expect(shouldAutoSpeakReply({ ...base, lastSpokenId: "a1" })).toBe(false);
  });

  test("empty conversation stays silent", () => {
    expect(shouldAutoSpeakReply({ ...base, lastMessage: undefined })).toBe(false);
  });
});
