"use client";

/**
 * ApprovalPeek — small global pill that surfaces the topmost pending approval
 * and lets the user approve / deny it with a single keystroke.
 *
 *   Y          approve the top pending tool call
 *   N          deny it (no reason — for verbose denial use the Approvals pane)
 *   Esc        dismiss the peek (re-appears when a new approval arrives)
 *
 * Keys are suppressed while the user is typing in an input/textarea/editable.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useShortcut } from "@/lib/hooks/useShortcuts";

interface PendingApproval {
  id: string;
  tool_name: string;
  reason: string | null;
  estimated_cost_usd: number | null;
  created_at: string;
}

const POLL_INTERVAL_MS = 4000;

export function ApprovalPeek() {
  const [pending, setPending] = useState<PendingApproval[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set());
  const inFlightRef = useRef(false);

  const reload = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const res = await fetch("/api/agui/approvals?status=pending", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { approvals: PendingApproval[] };
      setPending(data.approvals ?? []);
    } catch {
      /* ignore — surface only when API is reachable */
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    reload();
    const id = setInterval(reload, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [reload]);

  // Clear dismissals once their target is gone — so a fresh approval with the
  // same id (highly unlikely) would still show.
  useEffect(() => {
    if (dismissedIds.size === 0) return;
    const liveIds = new Set(pending.map((p) => p.id));
    let changed = false;
    const next = new Set<string>();
    dismissedIds.forEach((id) => {
      if (liveIds.has(id)) {
        next.add(id);
      } else {
        changed = true;
      }
    });
    if (changed) setDismissedIds(next);
  }, [pending, dismissedIds]);

  const visible = pending.filter((p) => !dismissedIds.has(p.id));
  const top = visible[0] ?? null;

  const decide = useCallback(
    async (id: string, decision: "approved" | "denied") => {
      await fetch("/api/agui/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, decision }),
      });
      // Optimistic remove so the pill disappears immediately.
      setPending((prev) => prev.filter((a) => a.id !== id));
      void reload();
    },
    [reload],
  );

  useShortcut(
    "y",
    () => {
      if (!top) return;
      void decide(top.id, "approved");
    },
    { when: "no-input", enabled: !!top, label: "Approve pending action" },
  );

  useShortcut(
    "n",
    () => {
      if (!top) return;
      void decide(top.id, "denied");
    },
    { when: "no-input", enabled: !!top, label: "Deny pending action" },
  );

  useShortcut(
    "escape",
    () => {
      if (!top) return;
      setDismissedIds((s) => {
        const next = new Set(s);
        next.add(top.id);
        return next;
      });
    },
    { when: "no-input", enabled: !!top, priority: 5, label: "Dismiss approval peek" },
  );

  if (!top) return null;

  return (
    <div className="ap-peek" role="status" aria-live="polite">
      <div className="ap-peek-bar" />
      <div className="ap-peek-body">
        <div className="ap-peek-line">
          <span className="ap-peek-label">approve</span>
          <span className="ap-peek-tool">{top.tool_name}</span>
          {top.estimated_cost_usd != null && (
            <span className="ap-peek-cost">${top.estimated_cost_usd.toFixed(4)}</span>
          )}
          {visible.length > 1 && (
            <span className="ap-peek-more" title={`${visible.length - 1} more queued`}>
              +{visible.length - 1}
            </span>
          )}
        </div>
        {top.reason && <div className="ap-peek-reason">{top.reason}</div>}
      </div>
      <div className="ap-peek-keys">
        <button
          type="button"
          className="ap-peek-key ap-peek-key--approve"
          onClick={() => decide(top.id, "approved")}
          title="Approve (Y)"
        >
          <kbd>Y</kbd>
          <span>approve</span>
        </button>
        <button
          type="button"
          className="ap-peek-key ap-peek-key--deny"
          onClick={() => decide(top.id, "denied")}
          title="Deny (N)"
        >
          <kbd>N</kbd>
        </button>
      </div>
    </div>
  );
}
