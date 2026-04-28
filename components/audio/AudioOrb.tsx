"use client";

/**
 * AudioOrb — compact state visualizer for the dock.
 *
 * Pure presentational. Reads a state label and an optional audio level
 * (0..1), and animates breathing/pulse via CSS classes. No analyser hookup
 * here — see AudioLevelMeter for the live ring.
 */

import type { VoiceSessionState } from "@/lib/voice/session-machine";

export interface AudioOrbProps {
  state: VoiceSessionState;
  level?: number;
  size?: number;
  onClick?: () => void;
  title?: string;
}

function classForState(state: VoiceSessionState): string {
  switch (state) {
    case "listening":
    case "arming":
      return "ad-orb--listening";
    case "transcribing":
    case "submitting":
      return "ad-orb--transcribing";
    case "thinking":
      return "ad-orb--thinking";
    case "speaking":
      return "ad-orb--speaking";
    case "interrupted":
      return "ad-orb--interrupted";
    case "reconnecting":
      return "ad-orb--reconnecting";
    case "error":
      return "ad-orb--error";
    default:
      return "ad-orb--idle";
  }
}

export function AudioOrb({ state, level = 0, size = 28, onClick, title }: AudioOrbProps) {
  const cls = classForState(state);
  const intensity = Math.max(0, Math.min(1, level));
  const inset = 28 - intensity * 18; // inner ring shrinks as level rises
  return (
    <button
      type="button"
      className={`ad-orb ${cls}`}
      style={{ width: size, height: size }}
      onClick={onClick}
      title={title}
      aria-label={title ?? "Audio orb"}
    >
      <span className="ad-orb__ring" />
      <span
        className="ad-orb__core"
        style={{ inset: `${inset}%` }}
      />
    </button>
  );
}
