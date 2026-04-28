/**
 * Audio modes — first-class deck-level interpretation of voice input.
 *
 * The same final transcript means different things in different modes:
 *   "new paragraph" in newsroom = insert block; in chat = a question.
 * Mode is owned by AudioDockProvider and consulted at the point a final
 * transcript is dispatched.
 */

export type AudioMode =
  | "off"
  | "chat"
  | "control"
  | "dictation"
  | "newsroom"
  | "command"
  | "diagnostic";

export const AUDIO_MODES: AudioMode[] = [
  "off",
  "chat",
  "control",
  "dictation",
  "newsroom",
  "command",
  "diagnostic",
];

export function labelForAudioMode(mode: AudioMode): string {
  switch (mode) {
    case "off":
      return "Off";
    case "chat":
      return "Chat";
    case "control":
      return "Control";
    case "dictation":
      return "Dictation";
    case "newsroom":
      return "Newsroom";
    case "command":
      return "Command";
    case "diagnostic":
      return "Diagnostic";
  }
}

export function describeAudioMode(mode: AudioMode): string {
  switch (mode) {
    case "off":
      return "Mic disabled.";
    case "chat":
      return "Submit transcripts as conversational chat turns.";
    case "control":
      return "Submit transcripts to the agent with stricter tool policy.";
    case "dictation":
      return "Insert text into the focused editor.";
    case "newsroom":
      return "Run detectCommand() then append draft blocks.";
    case "command":
      return "Local deck commands only — no general chat.";
    case "diagnostic":
      return "Show transcripts and latency without acting.";
  }
}

/** Mic should be active in any non-off mode. */
export function modeAllowsMic(mode: AudioMode): boolean {
  return mode !== "off";
}

/** TTS playback should be active for these modes by default. */
export function modeAllowsSpeak(mode: AudioMode): boolean {
  return mode === "chat" || mode === "control";
}
