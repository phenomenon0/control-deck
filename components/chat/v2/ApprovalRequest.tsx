"use client";

/**
 * ApprovalRequest (v2) — human-in-the-loop tool approval for the deck's AGUI
 * `InterruptRequested` event. Prop-driven (the container POSTs /api/chat/
 * approve|reject) so it's themeable + Storybook-testable. Shows the pending tool
 * call (name + args), Approve / Reject (+ optional reason), and the resolved
 * state. This is the gate before a sensitive tool runs.
 */

import { useState } from "react";
import { Check, ShieldAlert, X } from "lucide-react";

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface ApprovalRequestProps {
  toolName: string;
  args?: Record<string, unknown>;
  /** Optional human-readable explanation of why approval is needed. */
  message?: string;
  status?: ApprovalStatus;
  busy?: boolean;
  error?: string | null;
  onApprove: () => void;
  onReject: (reason?: string) => void;
}

const MONO = { fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" } as const;

export function ApprovalRequest({ toolName, args, message, status = "pending", busy = false, error, onApprove, onReject }: ApprovalRequestProps) {
  const [reason, setReason] = useState("");
  const argEntries = args ? Object.entries(args) : [];

  return (
    <div
      className="cd-approval rounded-[var(--radius-sm)] border"
      style={{ borderColor: "color-mix(in oklab, var(--warn, #fbbf24), transparent 50%)", background: "color-mix(in oklab, var(--warn, #fbbf24), transparent 92%)" }}
      role="group"
      aria-label="Approval required"
    >
      <div className="flex items-center gap-2 px-2.5 py-1.5" style={MONO}>
        <ShieldAlert size={14} style={{ color: "var(--warn, #fbbf24)" }} />
        <span className="text-[var(--text-primary)]" style={{ fontWeight: "var(--fw-strong, 600)", letterSpacing: "var(--tracking-label, 0.06em)" }}>
          APPROVAL NEEDED
        </span>
        <span className="text-[var(--text-secondary)]">· {toolName}</span>
        {status !== "pending" && (
          <span className="ml-auto" style={{ color: status === "approved" ? "var(--ok, #34d399)" : "var(--err, #f87171)" }}>
            {status}
          </span>
        )}
      </div>

      {message && (
        <p className="px-2.5 pb-1 text-[var(--text-secondary)]" style={{ fontFamily: "var(--font-sans)", fontSize: "var(--font-size-sm)" }}>
          {message}
        </p>
      )}

      {argEntries.length > 0 && (
        <pre className="mx-2.5 mb-2 overflow-x-auto rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-secondary)]" style={{ background: "var(--bg-inset, var(--bg))", ...MONO }}>
          <code>{argEntries.map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join("\n")}</code>
        </pre>
      )}

      {status === "pending" && (
        <div className="flex items-center gap-2 px-2.5 pb-2">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="reason (optional)"
            aria-label="Rejection reason"
            className="min-w-0 flex-1 rounded-[var(--radius-sm)] border bg-transparent px-2 py-1 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
            style={{ borderColor: "var(--border-subtle)", ...MONO }}
          />
          <button
            type="button"
            onClick={() => onReject(reason || undefined)}
            disabled={busy}
            aria-label="Reject"
            className="flex items-center gap-1 rounded-[var(--radius-sm)] border px-2 py-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] disabled:opacity-50"
            style={{ borderColor: "var(--border-subtle)", ...MONO }}
          >
            <X size={12} /> reject
          </button>
          <button
            type="button"
            onClick={onApprove}
            disabled={busy}
            aria-label="Approve"
            className="flex items-center gap-1 rounded-[var(--radius-sm)] px-2.5 py-1 font-medium transition-opacity disabled:opacity-50"
            style={{ background: "rgb(var(--accent-rgb))", color: "var(--text-on-accent)", ...MONO }}
          >
            <Check size={12} /> approve
          </button>
        </div>
      )}

      {error && (
        <div className="px-2.5 pb-2" style={{ color: "var(--err, #f87171)", ...MONO }}>{error}</div>
      )}
    </div>
  );
}

export default ApprovalRequest;
