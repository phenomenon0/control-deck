/**
 * Voice session state machine.
 *
 * One canonical finite-state machine for the voice turn lifecycle. All voice
 * surfaces (Live tab, fullscreen voice mode, inline chat mic) drive this
 * through `dispatchVoiceEvent`. UI reads a single enum state instead of
 * triangulating across four booleans.
 *
 * Invalid transitions are ignored and reported via `result.reason` so the
 * machine never throws on unexpected events. Callers that want to react to
 * an ignored event should check `result.changed === false`.
 */

export type VoiceSessionState =
  | "idle"
  | "arming" // got mic, not yet recording
  | "listening"
  | "transcribing" // user utterance captured, awaiting STT result
  | "submitting" // transcript ready, dispatching to agent
  | "thinking" // agent running, no audio yet
  | "speaking" // assistant audio playing
  | "confirming" // agent paused for an exact-phrase voice approval
  | "interrupted" // user cut the assistant; brief state before returning to listening
  | "reconnecting"
  | "error";

export type VoiceSessionEvent =
  | { type: "MIC_REQUESTED" }
  | { type: "MIC_GRANTED" }
  | { type: "MIC_DENIED"; error: string }
  | { type: "VOICE_STARTED" }
  | { type: "VOICE_ENDED" }
  | { type: "TRANSCRIPT_PARTIAL"; text: string }
  | { type: "TRANSCRIPT_FINAL"; text: string }
  | { type: "TRANSCRIPT_EMPTY" }
  | { type: "RUN_STARTED" }
  | { type: "RUN_STREAMING" }
  | { type: "AUDIO_STARTED" }
  | { type: "AUDIO_STOPPED" }
  | { type: "INTERRUPT" }
  | { type: "APPROVAL_CHALLENGE" }
  | { type: "APPROVAL_GRANTED" }
  | { type: "APPROVAL_REJECTED" }
  | { type: "NETWORK_LOST" }
  | { type: "NETWORK_RESTORED" }
  | { type: "FAIL"; error: string }
  | { type: "RESET" };

export interface VoiceSessionContext {
  state: VoiceSessionState;
  transcriptPartial: string;
  transcriptFinal: string;
  error: string | null;
  /** Monotonically increasing turn id; bumps at end of a full round-trip. */
  turnId: number;
  /** Epoch ms of the last transition into this state. */
  enteredAt: number;
}

export function initialContext(): VoiceSessionContext {
  return {
    state: "idle",
    transcriptPartial: "",
    transcriptFinal: "",
    error: null,
    turnId: 0,
    enteredAt: Date.now(),
  };
}

export interface TransitionResult {
  context: VoiceSessionContext;
  changed: boolean;
  reason?: string;
}

function transition(
  ctx: VoiceSessionContext,
  next: Partial<VoiceSessionContext> & { state: VoiceSessionState },
): TransitionResult {
  if (next.state === ctx.state) {
    return { context: { ...ctx, ...next }, changed: hasNonStateChange(ctx, next) };
  }
  return {
    context: {
      ...ctx,
      ...next,
      state: next.state,
      enteredAt: Date.now(),
    },
    changed: true,
  };
}

function hasNonStateChange(
  ctx: VoiceSessionContext,
  next: Partial<VoiceSessionContext>,
): boolean {
  if (next.transcriptPartial !== undefined && next.transcriptPartial !== ctx.transcriptPartial) return true;
  if (next.transcriptFinal !== undefined && next.transcriptFinal !== ctx.transcriptFinal) return true;
  if (next.error !== undefined && next.error !== ctx.error) return true;
  return false;
}

function ignore(ctx: VoiceSessionContext, reason: string): TransitionResult {
  return { context: ctx, changed: false, reason };
}

export function reduceVoiceSession(
  ctx: VoiceSessionContext,
  event: VoiceSessionEvent,
): TransitionResult {
  // Global events that apply from any state.
  if (event.type === "RESET") {
    return transition(ctx, {
      state: "idle",
      transcriptPartial: "",
      transcriptFinal: "",
      error: null,
      turnId: ctx.turnId + 1,
    });
  }
  if (event.type === "FAIL") {
    return transition(ctx, { state: "error", error: event.error });
  }
  if (event.type === "NETWORK_LOST") {
    return transition(ctx, { state: "reconnecting" });
  }
  if (event.type === "NETWORK_RESTORED") {
    if (ctx.state === "reconnecting") return transition(ctx, { state: "idle" });
    return ignore(ctx, "network restored while not reconnecting");
  }

  switch (ctx.state) {
    case "idle":
    case "error":
    case "interrupted":
      if (event.type === "MIC_REQUESTED") {
        return transition(ctx, { state: "arming", error: null });
      }
      // Allow a late AUDIO_STARTED (e.g. read-aloud of a previous assistant
      // message) to move into speaking without a prior run.
      if (event.type === "AUDIO_STARTED") {
        return transition(ctx, { state: "speaking" });
      }
      return ignore(ctx, `event ${event.type} ignored in ${ctx.state}`);

    case "arming":
      if (event.type === "MIC_GRANTED") {
        return transition(ctx, { state: "listening", transcriptPartial: "", transcriptFinal: "" });
      }
      if (event.type === "MIC_DENIED") {
        return transition(ctx, { state: "error", error: event.error });
      }
      return ignore(ctx, `event ${event.type} ignored in arming`);

    case "listening":
      if (event.type === "TRANSCRIPT_PARTIAL") {
        return transition(ctx, { state: "listening", transcriptPartial: event.text });
      }
      if (event.type === "VOICE_ENDED") {
        return transition(ctx, { state: "transcribing" });
      }
      if (event.type === "INTERRUPT") {
        return transition(ctx, { state: "idle" });
      }
      return ignore(ctx, `event ${event.type} ignored in listening`);

    case "transcribing":
      if (event.type === "TRANSCRIPT_EMPTY") {
        return transition(ctx, {
          state: "idle",
          transcriptPartial: "",
          transcriptFinal: "",
        });
      }
      if (event.type === "TRANSCRIPT_FINAL") {
        return transition(ctx, {
          state: "submitting",
          transcriptFinal: event.text,
          transcriptPartial: "",
        });
      }
      if (event.type === "TRANSCRIPT_PARTIAL") {
        return transition(ctx, { state: "transcribing", transcriptPartial: event.text });
      }
      return ignore(ctx, `event ${event.type} ignored in transcribing`);

    case "submitting":
      if (event.type === "RUN_STARTED") {
        return transition(ctx, { state: "thinking" });
      }
      return ignore(ctx, `event ${event.type} ignored in submitting`);

    case "thinking":
      if (event.type === "AUDIO_STARTED") {
        return transition(ctx, { state: "speaking" });
      }
      if (event.type === "RUN_STREAMING") {
        // Stay in thinking — some text arriving but no audio yet.
        return ignore(ctx, "streaming text without audio keeps thinking");
      }
      if (event.type === "INTERRUPT") {
        return transition(ctx, { state: "interrupted", turnId: ctx.turnId + 1 });
      }
      if (event.type === "APPROVAL_CHALLENGE") {
        return transition(ctx, { state: "confirming" });
      }
      // No-audio assistant turn (text-only reply, sidecar dropped TTS, etc.).
      // Watchdog can fire AUDIO_STOPPED to escape `thinking` cleanly without
      // forcing the user to manually reset the session.
      if (event.type === "AUDIO_STOPPED") {
        return transition(ctx, { state: "idle", turnId: ctx.turnId + 1 });
      }
      return ignore(ctx, `event ${event.type} ignored in thinking`);

    case "speaking":
      if (event.type === "AUDIO_STOPPED") {
        return transition(ctx, { state: "idle", turnId: ctx.turnId + 1 });
      }
      if (event.type === "INTERRUPT") {
        return transition(ctx, { state: "interrupted", turnId: ctx.turnId + 1 });
      }
      if (event.type === "APPROVAL_CHALLENGE") {
        return transition(ctx, { state: "confirming" });
      }
      if (event.type === "MIC_REQUESTED") {
        // Starting to talk while assistant is speaking = barge-in.
        return transition(ctx, { state: "arming", error: null });
      }
      return ignore(ctx, `event ${event.type} ignored in speaking`);

    case "confirming":
      if (event.type === "APPROVAL_GRANTED") {
        return transition(ctx, { state: "thinking" });
      }
      if (event.type === "APPROVAL_REJECTED") {
        return transition(ctx, { state: "interrupted", turnId: ctx.turnId + 1 });
      }
      if (event.type === "INTERRUPT") {
        return transition(ctx, { state: "interrupted", turnId: ctx.turnId + 1 });
      }
      return ignore(ctx, `event ${event.type} ignored in confirming`);

    case "reconnecting":
      return ignore(ctx, `event ${event.type} ignored while reconnecting`);
  }
}

export function isInterruptible(state: VoiceSessionState): boolean {
  return state === "speaking" || state === "thinking" || state === "confirming";
}

export function isListening(state: VoiceSessionState): boolean {
  return state === "listening" || state === "arming";
}

export function labelForState(state: VoiceSessionState): string {
  switch (state) {
    case "idle":
      return "Idle";
    case "arming":
      return "Getting mic…";
    case "listening":
      return "Listening";
    case "transcribing":
      return "Transcribing";
    case "submitting":
      return "Sending";
    case "thinking":
      return "Thinking";
    case "speaking":
      return "Speaking";
    case "confirming":
      return "Awaiting confirmation";
    case "interrupted":
      return "Interrupted";
    case "reconnecting":
      return "Reconnecting";
    case "error":
      return "Error";
  }
}
