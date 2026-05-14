import { describe, expect, test } from "bun:test";

import { decideSpeakingBridge } from "./speaking-bridge";

// The bridge in use-voice-session.ts maps voiceChat.isSpeaking flips into
// FSM AUDIO_STARTED / AUDIO_STOPPED events. Two failure modes used to bite:
//   - Multi-phrase non-streaming replies flipped isSpeaking false between
//     phrases (pending=0 gap) and dispatched AUDIO_STOPPED → FSM idle →
//     mic re-armed during the reply → echo loop / truncation.
//   - The streaming TTS lane also flips isSpeaking but already emits its own
//     speechEnd, so any bridge dispatch from the raw flag would double-count.
// These tests pin both short-circuits to the production predicate.

describe("decideSpeakingBridge", () => {
  test("first speaking flip dispatches AUDIO_STARTED", () => {
    const result = decideSpeakingBridge(false, true, true, false);
    expect(result.event).toBe("AUDIO_STARTED");
    expect(result.nextPrev).toBe(true);
  });

  test("inter-phrase false-flip is swallowed while a reply is in flight", () => {
    // Phrase 1 plays (prev=true), pending=0 gap arrives (curr=false), but
    // runTurn has not yet hit `finally` so replyInFlight stays true. The
    // bridge must NOT dispatch AUDIO_STOPPED — otherwise the FSM transitions
    // speaking → idle and the continuous-arm loop fires the mic.
    const result = decideSpeakingBridge(true, false, true, false);
    expect(result.event).toBeNull();
    expect(result.nextPrev).toBe(false);
  });

  test("false-flip after runTurn finishes dispatches AUDIO_STOPPED", () => {
    // Once `replyInFlight` clears in runTurn's finally, the next legitimate
    // end-of-reply flip must reach the FSM so the mic can re-arm.
    const result = decideSpeakingBridge(true, false, false, false);
    expect(result.event).toBe("AUDIO_STOPPED");
    expect(result.nextPrev).toBe(false);
  });

  test("streaming lane swallows all flips and clamps prev to false", () => {
    // Streaming TTS owns its own speechEnd. The flag-based bridge must be a
    // no-op so AUDIO_STARTED / AUDIO_STOPPED come from AgentOutput, not from
    // the per-buffer source flicker.
    const started = decideSpeakingBridge(false, true, true, true);
    expect(started.event).toBeNull();
    expect(started.nextPrev).toBe(false);

    const stopped = decideSpeakingBridge(true, false, true, true);
    expect(stopped.event).toBeNull();
    expect(stopped.nextPrev).toBe(false);
  });

  test("no-op when the speaking flag does not flip", () => {
    expect(decideSpeakingBridge(false, false, false, false).event).toBeNull();
    expect(decideSpeakingBridge(true, true, false, false).event).toBeNull();
  });

  test("multi-phrase sequence: only the final flip after finally dispatches once", () => {
    // Simulate isSpeaking: false → true (phrase1 start) → false (gap) →
    // true (phrase2 start) → false (real end, after finally has run).
    let prev = false;
    let replyInFlight = true;
    const events: string[] = [];

    for (const curr of [true, false, true]) {
      const d = decideSpeakingBridge(prev, curr, replyInFlight, false);
      if (d.event) events.push(d.event);
      prev = d.nextPrev;
    }
    // Final flip arrives after runTurn's finally clears the flag.
    replyInFlight = false;
    const last = decideSpeakingBridge(prev, false, replyInFlight, false);
    if (last.event) events.push(last.event);

    expect(events).toEqual(["AUDIO_STARTED", "AUDIO_STARTED", "AUDIO_STOPPED"]);
  });
});
