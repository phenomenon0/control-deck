"use client";

/**
 * InterruptButton — visible only while the assistant is interruptible
 * (thinking/speaking/submitting). Calls VoiceSessionApi.interrupt(),
 * which already aborts the chat fetch, drains TTS, and stops playback.
 */

import { Icon } from "@/components/warp/Icons";
import { useAudioDock } from "./AudioDockProvider";

export function InterruptButton({ compact = false }: { compact?: boolean }) {
  const { session } = useAudioDock();
  if (!session.isInterruptible) return null;
  return (
    <button
      type="button"
      className={`ad-btn ad-btn--interrupt ${compact ? "ad-btn--compact" : ""}`}
      onClick={() => void session.interrupt()}
      title="Interrupt"
      aria-label="Interrupt"
    >
      <Icon.Stop size={13} />
      {!compact ? <span>Stop</span> : null}
    </button>
  );
}
