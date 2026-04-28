import { describe, expect, test } from "bun:test";

import {
  initialContext,
  isInterruptible,
  isListening,
  reduceVoiceSession,
  type VoiceSessionEvent,
} from "./session-machine";

function run(events: VoiceSessionEvent[]) {
  let ctx = initialContext();
  for (const event of events) {
    ctx = reduceVoiceSession(ctx, event).context;
  }
  return ctx;
}

describe("voice session machine", () => {
  test("full happy path: listen → transcribe → think → speak → idle", () => {
    const ctx = run([
      { type: "MIC_REQUESTED" },
      { type: "MIC_GRANTED" },
      { type: "TRANSCRIPT_PARTIAL", text: "hel" },
      { type: "VOICE_ENDED" },
      { type: "TRANSCRIPT_FINAL", text: "hello" },
      { type: "RUN_STARTED" },
      { type: "AUDIO_STARTED" },
      { type: "AUDIO_STOPPED" },
    ]);
    expect(ctx.state).toBe("idle");
    expect(ctx.transcriptFinal).toBe("hello");
    expect(ctx.turnId).toBe(1);
  });

  test("interrupt during speaking transitions to interrupted and bumps turn", () => {
    const ctx = run([
      { type: "MIC_REQUESTED" },
      { type: "MIC_GRANTED" },
      { type: "VOICE_ENDED" },
      { type: "TRANSCRIPT_FINAL", text: "hello" },
      { type: "RUN_STARTED" },
      { type: "AUDIO_STARTED" },
      { type: "INTERRUPT" },
    ]);
    expect(ctx.state).toBe("interrupted");
    expect(ctx.turnId).toBe(1);
  });

  test("mic-request during speaking (barge-in) transitions to arming", () => {
    const ctx = run([
      { type: "MIC_REQUESTED" },
      { type: "MIC_GRANTED" },
      { type: "VOICE_ENDED" },
      { type: "TRANSCRIPT_FINAL", text: "hello" },
      { type: "RUN_STARTED" },
      { type: "AUDIO_STARTED" },
      { type: "MIC_REQUESTED" },
    ]);
    expect(ctx.state).toBe("arming");
  });

  test("mic denied transitions to error", () => {
    const ctx = run([
      { type: "MIC_REQUESTED" },
      { type: "MIC_DENIED", error: "permission denied" },
    ]);
    expect(ctx.state).toBe("error");
    expect(ctx.error).toBe("permission denied");
  });

  test("RESET from error returns to idle and clears error", () => {
    const ctx = run([
      { type: "MIC_REQUESTED" },
      { type: "MIC_DENIED", error: "permission denied" },
      { type: "RESET" },
    ]);
    expect(ctx.state).toBe("idle");
    expect(ctx.error).toBeNull();
  });

  test("network lost transitions to reconnecting and blocks events", () => {
    let ctx = initialContext();
    ctx = reduceVoiceSession(ctx, { type: "NETWORK_LOST" }).context;
    expect(ctx.state).toBe("reconnecting");
    const res = reduceVoiceSession(ctx, { type: "MIC_REQUESTED" });
    expect(res.changed).toBe(false);
    expect(res.context.state).toBe("reconnecting");
  });

  test("partial transcript updates text without changing state", () => {
    let ctx = initialContext();
    ctx = reduceVoiceSession(ctx, { type: "MIC_REQUESTED" }).context;
    ctx = reduceVoiceSession(ctx, { type: "MIC_GRANTED" }).context;
    const res = reduceVoiceSession(ctx, { type: "TRANSCRIPT_PARTIAL", text: "he" });
    expect(res.changed).toBe(true);
    expect(res.context.state).toBe("listening");
    expect(res.context.transcriptPartial).toBe("he");
  });

  test("empty streaming STT final returns from transcribing to idle", () => {
    const ctx = run([
      { type: "MIC_REQUESTED" },
      { type: "MIC_GRANTED" },
      { type: "VOICE_ENDED" },
      { type: "TRANSCRIPT_EMPTY" },
    ]);
    expect(ctx.state).toBe("idle");
    expect(ctx.transcriptFinal).toBe("");
  });

  test("invalid transitions are ignored without throwing", () => {
    const res = reduceVoiceSession(initialContext(), { type: "VOICE_ENDED" });
    expect(res.changed).toBe(false);
    expect(res.reason).toBeDefined();
  });

  test("isInterruptible is true while thinking or speaking", () => {
    expect(isInterruptible("thinking")).toBe(true);
    expect(isInterruptible("speaking")).toBe(true);
    expect(isInterruptible("idle")).toBe(false);
    expect(isInterruptible("listening")).toBe(false);
  });

  test("isListening captures arming and listening states", () => {
    expect(isListening("arming")).toBe(true);
    expect(isListening("listening")).toBe(true);
    expect(isListening("idle")).toBe(false);
    expect(isListening("speaking")).toBe(false);
  });

  test("read-aloud path: idle → speaking via AUDIO_STARTED without a run", () => {
    const ctx = run([{ type: "AUDIO_STARTED" }]);
    expect(ctx.state).toBe("speaking");
  });

  test("AUDIO_STOPPED in thinking exits to idle (no-audio assistant turn / watchdog)", () => {
    // Thinking with no AUDIO_STARTED used to be a dead-end — only AUDIO_STARTED
    // or INTERRUPT could move it. A text-only reply or a dropped TTS frame
    // would freeze the orb forever. AUDIO_STOPPED now provides the escape.
    const ctx = run([
      { type: "MIC_REQUESTED" },
      { type: "MIC_GRANTED" },
      { type: "VOICE_ENDED" },
      { type: "TRANSCRIPT_FINAL", text: "ping" },
      { type: "RUN_STARTED" },
      { type: "AUDIO_STOPPED" }, // watchdog or text-only reply
    ]);
    expect(ctx.state).toBe("idle");
    expect(ctx.turnId).toBe(1);
  });
});
