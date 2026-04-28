"use client";

/**
 * VoiceApprovalCard — full-surface approval prompt for the voice modes.
 *
 * Shown when `useVoiceSession().pendingApproval` is non-null. Reads the
 * required phrase aloud (via the existing TTS path), tracks how the
 * incoming partial transcript compares to it, and exposes Approve / Reject
 * buttons as a fallback for users who'd rather click than speak.
 *
 * This card is render-only — `confirmApproval` lives on the session.
 */

import { useMemo } from "react";
import { useOptionalVoiceSession } from "@/lib/voice/VoiceSessionContext";
import { matchPhrase, isCancellation } from "@/lib/voice/voice-approval";

export function VoiceApprovalCard() {
  const session = useOptionalVoiceSession();
  const challenge = session?.pendingApproval ?? null;
  const partial = session?.transcriptPartial ?? "";

  const matchState = useMemo(() => {
    if (!challenge) return "idle" as const;
    if (isCancellation(partial)) return "cancel" as const;
    if (matchPhrase(challenge, partial)) return "match" as const;
    return "listening" as const;
  }, [challenge, partial]);

  if (!challenge || !session) return null;

  const expiresIn = Math.max(0, Math.round((challenge.expiresAt - Date.now()) / 1000));

  return (
    <div className={`v-approval v-approval--${challenge.risk}`} role="alertdialog">
      <div className="v-approval__head">
        <span className="v-approval__risk">{challenge.risk}</span>
        <span className="v-approval__tool">{challenge.toolName}</span>
        <span className="v-approval__timer">{expiresIn}s</span>
      </div>
      <p className="v-approval__summary">{challenge.summary}</p>
      <p className="v-approval__phrase">
        Say <em>“{challenge.requiredPhrase}”</em> to approve.
      </p>
      {partial ? (
        <p className={`v-approval__heard v-approval__heard--${matchState}`}>{partial}</p>
      ) : null}
      <div className="v-approval__buttons">
        <button
          type="button"
          className="ad-btn ad-btn--ghost"
          onClick={() => void session.confirmApproval("rejected", "user-cancelled")}
        >
          Cancel
        </button>
        <button
          type="button"
          className="ad-btn ad-btn--accent"
          onClick={() => void session.confirmApproval("approved")}
        >
          Approve
        </button>
      </div>
    </div>
  );
}
