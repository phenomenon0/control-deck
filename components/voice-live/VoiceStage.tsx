"use client";

/**
 * VoiceStage — the central voice action surface.
 *
 * One obvious talk target (orb), an unmissable state label (Listening /
 * Thinking / Speaking / Interrupted), and a live partial transcript above.
 * Replaces the "chat with badges" feel — this is what makes Live read as a
 * voice-native experience.
 */

import { useCallback } from "react";

import type { VoiceSessionApi } from "@/lib/voice/use-voice-session";
import { isInterruptible } from "@/lib/voice/session-machine";

interface VoiceStageProps {
  session: VoiceSessionApi;
  compact?: boolean;
  /** Optional caption under the orb (e.g. "Hold space to talk"). */
  hint?: string;
}

export function VoiceStage({ session, compact = false, hint }: VoiceStageProps) {
  const { state, audioLevel } = session;
  const canInterrupt = isInterruptible(state);

  const primary = useCallback(async () => {
    if (canInterrupt) {
      await session.interrupt();
      return;
    }
    if (session.isListening) {
      await session.stopListening();
      return;
    }
    await session.startListening();
  }, [canInterrupt, session]);

  const primaryLabel = canInterrupt
    ? "Interrupt"
    : session.isListening
    ? "Stop"
    : "Tap to talk";

  const size = compact ? 96 : 160;
  const pulseScale = 1 + Math.min(0.35, audioLevel * 2);

  return (
    <div
      className="flex flex-col items-center justify-center gap-4 py-6 select-none"
      aria-live="polite"
    >
      {/* Partial transcript (live captioning) */}
      <div className={compact ? "min-h-6" : "min-h-8"}>
        {session.transcriptPartial ? (
          <div className="text-sm text-[var(--text-muted)] italic">
            &ldquo;{session.transcriptPartial}&rdquo;
          </div>
        ) : session.transcriptFinal && state === "thinking" ? (
          <div className="text-sm text-[var(--text-muted)]">
            &ldquo;{session.transcriptFinal}&rdquo;
          </div>
        ) : null}
      </div>

      {/* Orb */}
      <button
        type="button"
        onClick={primary}
        className="relative rounded-full border transition-transform focus:outline-none"
        style={{
          width: size,
          height: size,
          borderColor: orbColor(state),
          background: orbGradient(state),
          boxShadow: state === "listening" ? `0 0 48px ${orbColor(state)}40` : "none",
          transform: state === "listening" ? `scale(${pulseScale})` : "scale(1)",
          transition: "transform 60ms linear, box-shadow 200ms ease",
        }}
        aria-label={primaryLabel}
      >
        <OrbGlyph state={state} size={size} />
      </button>

      {/* State label */}
      <div className="flex flex-col items-center gap-0.5">
        <div
          className="text-xs uppercase tracking-widest font-medium"
          style={{ color: orbColor(state) }}
        >
          {stateCopy(state)}
        </div>
        <div className="text-xs text-[var(--text-muted)]">{primaryLabel}{hint ? ` · ${hint}` : ""}</div>
      </div>

      {/* Error line */}
      {session.error ? (
        <div className="text-xs text-[var(--error)] max-w-xs text-center">{session.error}</div>
      ) : null}
    </div>
  );
}

function stateCopy(state: VoiceSessionApi["state"]): string {
  switch (state) {
    case "idle":
      return "Ready";
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
      return "Confirm to proceed";
    case "interrupted":
      return "Interrupted";
    case "reconnecting":
      return "Reconnecting";
    case "error":
      return "Error";
  }
}

function orbColor(state: VoiceSessionApi["state"]): string {
  switch (state) {
    case "listening":
      return "var(--accent)";
    case "speaking":
      return "var(--success)";
    case "thinking":
    case "submitting":
    case "transcribing":
      return "var(--warning)";
    case "interrupted":
      return "var(--warning)";
    case "error":
      return "var(--error)";
    case "reconnecting":
      return "var(--warning)";
    default:
      return "var(--border)";
  }
}

function orbGradient(state: VoiceSessionApi["state"]): string {
  const c = orbColor(state);
  if (state === "idle") {
    return `radial-gradient(circle, var(--bg-secondary) 0%, var(--bg-primary) 100%)`;
  }
  return `radial-gradient(circle, ${c}20 0%, var(--bg-primary) 70%)`;
}

function OrbGlyph({
  state,
  size,
}: {
  state: VoiceSessionApi["state"];
  size: number;
}) {
  const barHeight = size * 0.32;
  const color = orbColor(state);
  if (state === "speaking") {
    return (
      <div className="flex items-end justify-center gap-1 h-full w-full">
        {[0.4, 0.7, 0.95, 0.7, 0.4].map((h, i) => (
          <span
            key={i}
            className="w-1 rounded-full voice-bar"
            style={{
              height: barHeight * h,
              backgroundColor: color,
              animationDelay: `${i * 80}ms`,
            }}
          />
        ))}
      </div>
    );
  }
  if (state === "listening" || state === "arming") {
    return (
      <div
        className="rounded-full mx-auto my-auto"
        style={{ width: size * 0.3, height: size * 0.3, backgroundColor: color, opacity: 0.8 }}
      />
    );
  }
  if (state === "thinking" || state === "submitting" || state === "transcribing") {
    return (
      <div
        className="rounded-full mx-auto my-auto animate-pulse"
        style={{
          width: size * 0.24,
          height: size * 0.24,
          borderColor: color,
          borderWidth: 2,
          borderStyle: "solid",
        }}
      />
    );
  }
  // Idle: mic glyph
  return (
    <svg
      width={size * 0.32}
      height={size * 0.32}
      viewBox="0 0 24 24"
      className="mx-auto my-auto"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      style={{ color: "var(--text-muted)" }}
    >
      <path d="M12 18v2m-4-2h8M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M5 10a7 7 0 0 0 14 0" />
    </svg>
  );
}
