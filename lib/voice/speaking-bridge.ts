// Pure decision predicate for the `voiceChat.isSpeaking` → FSM bridge used in
// `use-voice-session.ts`. Lifted into its own file so it can be unit-tested
// without mounting React. Two short-circuits guard against false AUDIO_STOPPED
// dispatches mid-reply:
//
// 1. `streamingActive` — the streaming TTS lane drives AUDIO_STARTED /
//    AUDIO_STOPPED from its own per-handle `speechEnd` callback. Any flip of
//    `voiceChat.isSpeaking` is incidental and must not reach the FSM.
// 2. `replyInFlight` — the non-streaming lane decrements its pending-jobs
//    counter when each phrase's fetch resolves, *before* the audio for that
//    phrase plays. Between phrases the queue can briefly be empty with
//    pending=0, causing `isSpeaking` to flip false → true again as the next
//    phrase arrives. Without this guard the FSM would transition
//    speaking → idle mid-reply, re-arm the mic, and either truncate the
//    remaining phrases (barge-in) or echo-loop the assistant's own audio
//    back through STT.

export type BridgeEvent = "AUDIO_STARTED" | "AUDIO_STOPPED" | null;

export interface BridgeDecision {
  event: BridgeEvent;
  nextPrev: boolean;
}

export function decideSpeakingBridge(
  prev: boolean,
  curr: boolean,
  replyInFlight: boolean,
  streamingActive: boolean,
): BridgeDecision {
  if (streamingActive) {
    // Streaming lane drives the bridge itself. Reset prev so a later
    // non-streaming transition isn't compared against a stale value.
    return { event: null, nextPrev: false };
  }
  if (curr && !prev) {
    return { event: "AUDIO_STARTED", nextPrev: curr };
  }
  if (!curr && prev) {
    if (replyInFlight) {
      // Inter-phrase pending=0 gap — swallow the false-flip.
      return { event: null, nextPrev: curr };
    }
    return { event: "AUDIO_STOPPED", nextPrev: curr };
  }
  return { event: null, nextPrev: curr };
}
