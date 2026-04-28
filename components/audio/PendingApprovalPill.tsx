"use client";

/**
 * PendingApprovalPill — surfaces the active VoiceApprovalChallenge in the
 * dock. Click to open VoiceApprovalCard (TBD); for now exposes accept/reject
 * directly as keyboard-friendly buttons.
 */

import { useAudioDock } from "./AudioDockProvider";

export function PendingApprovalPill() {
  const { pendingApproval, resolveApproval } = useAudioDock();
  if (!pendingApproval) return null;

  const { approvalId, toolName, risk, requiredPhrase } = pendingApproval;

  return (
    <div className={`ad-approval ad-approval--${risk}`} role="alert">
      <span className="ad-approval__label">Approval</span>
      <span className="ad-approval__tool">{toolName}</span>
      <span className="ad-approval__phrase" title={`Say: "${requiredPhrase}"`}>
        “{requiredPhrase}”
      </span>
      <button
        type="button"
        className="ad-btn ad-btn--ghost"
        onClick={() => resolveApproval(approvalId, "rejected")}
      >
        Cancel
      </button>
      <button
        type="button"
        className="ad-btn ad-btn--accent"
        onClick={() => resolveApproval(approvalId, "accepted")}
      >
        Approve
      </button>
    </div>
  );
}
