"use client";

/**
 * ApprovalsQueue — the Cowork-style pending-action inbox. Users approve or
 * deny gated tool calls here. Before the dispatch hook lands, the queue is
 * read-only plus a dev "create test approval" button hidden behind ⌘-click.
 */

import { useCallback, useEffect, useState } from "react";
import { ToolCallDiff } from "./ToolCallDiff";

interface Approval {
  id: string;
  run_id: string | null;
  thread_id: string | null;
  tool_name: string;
  tool_args: unknown;
  estimated_cost_usd: number | null;
  reason: string | null;
  status: "pending" | "approved" | "denied" | "expired";
  decision_by: string | null;
  decision_note: string | null;
  created_at: string;
  decided_at: string | null;
}

type Filter = "pending" | "all";

export function ApprovalsQueue() {
  const [filter, setFilter] = useState<Filter>("pending");
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const url = filter === "pending" ? "/api/agui/approvals?status=pending" : "/api/agui/approvals";
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      setApprovals([]);
      setLoading(false);
      return;
    }
    const data = (await res.json()) as { approvals: Approval[] };
    setApprovals(data.approvals);
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    reload();
    const id = setInterval(reload, 5000);
    return () => clearInterval(id);
  }, [reload]);

  const decide = useCallback(
    async (id: string, decision: "approved" | "denied", note?: string) => {
      await fetch("/api/agui/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, decision, note }),
      });
      await reload();
    },
    [reload],
  );

  const createTestApproval = useCallback(async () => {
    await fetch("/api/agui/approvals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        create: true,
        toolName: "test.action",
        toolArgs: { sample: true, risk: "low" },
        reason: "Manually created test approval",
        estimatedCostUsd: 0.01,
      }),
    });
    await reload();
  }, [reload]);

  const pendingCount = approvals.filter((a) => a.status === "pending").length;

  return (
    <div className="approvals-queue">
      <div className="approvals-head">
        <div>
          <div className="label">Approval queue</div>
          <h2>Pending actions</h2>
          <p>
            Tool calls gated by your approval policy wait here for a decision. {pendingCount} pending.
          </p>
        </div>
        <div className="approvals-actions">
          <div className="approvals-filter">
            {(["pending", "all"] as const).map((f) => (
              <button
                key={f}
                type="button"
                className={`approvals-filter-btn${filter === f ? " on" : ""}`}
                onClick={() => setFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="approvals-test-btn"
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey) createTestApproval();
            }}
            title="⌘-click to inject a test approval (dispatch hook lands later)"
          >
            + Test
          </button>
        </div>
      </div>

      {loading ? (
        <div className="approvals-empty">Loading…</div>
      ) : approvals.length === 0 ? (
        <div className="approvals-empty">
          No {filter === "pending" ? "pending" : ""} approvals.
        </div>
      ) : (
        <div className="approvals-list">
          {approvals.map((a) => (
            <article key={a.id} className={`approval-card approval-card--${a.status}`}>
              <header>
                <div>
                  <div className="approval-tool">{a.tool_name}</div>
                  <div className="approval-meta">
                    {new Date(a.created_at).toLocaleString()}
                    {a.estimated_cost_usd !== null && (
                      <span> · est. ${a.estimated_cost_usd.toFixed(4)}</span>
                    )}
                    {a.thread_id && <span> · thread {a.thread_id.slice(0, 8)}</span>}
                  </div>
                </div>
                <span className={`approval-status approval-status--${a.status}`}>{a.status}</span>
              </header>
              {a.reason && <p className="approval-reason">{a.reason}</p>}
              <ToolCallDiff toolName={a.tool_name} args={a.tool_args} />
              {a.status === "pending" && (
                <footer>
                  <button
                    type="button"
                    className="approval-btn approval-btn--approve"
                    onClick={() => decide(a.id, "approved")}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="approval-btn approval-btn--deny"
                    onClick={() => decide(a.id, "denied")}
                  >
                    Deny
                  </button>
                </footer>
              )}
              {a.decision_note && (
                <div className="approval-decision-note">note: {a.decision_note}</div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
