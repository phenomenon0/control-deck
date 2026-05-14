"use client";

/**
 * ApprovalsQueue — pending-action inbox for gated tool calls.
 *
 * Interaction rules:
 *  - Approve is the primary action (solid). Deny is secondary (ghost).
 *  - Deny opens an inline note input first so denials carry a reason.
 *  - Hot-keys when the queue is focused: A approves the topmost pending,
 *    D opens the deny note for it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

const MUTATING_TOOLS = new Set([
  "edit", "write", "execute_code", "bash", "sh",
  "vector_store", "vector_ingest",
  "generate_image", "edit_image", "generate_audio", "image_to_3d", "glyph_motif",
]);

const NATIVE_OS_PREFIX = "native_";

function riskOf(toolName: string): "low" | "mutating" | "system" {
  if (toolName.startsWith(NATIVE_OS_PREFIX)) return "system";
  if (MUTATING_TOOLS.has(toolName)) return "mutating";
  return "low";
}

export function ApprovalsQueue() {
  const [filter, setFilter] = useState<Filter>("pending");
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [denyingId, setDenyingId] = useState<string | null>(null);
  const [denyNote, setDenyNote] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);

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
      setDenyingId((current) => (current === id ? null : current));
      setDenyNote("");
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

  const counts = useMemo(() => {
    const pending = approvals.filter((a) => a.status === "pending").length;
    return { pending, total: approvals.length };
  }, [approvals]);

  // Hot-keys when focus is inside the queue.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const first = approvals.find((a) => a.status === "pending");
      if (!first) return;
      if (e.key === "a" || e.key === "A") {
        e.preventDefault();
        void decide(first.id, "approved");
      } else if (e.key === "d" || e.key === "D") {
        e.preventDefault();
        setDenyingId(first.id);
      } else if (e.key === "Escape" && denyingId) {
        e.preventDefault();
        setDenyingId(null);
        setDenyNote("");
      }
    };
    root.addEventListener("keydown", handler);
    return () => root.removeEventListener("keydown", handler);
  }, [approvals, decide, denyingId]);

  return (
    <div className="approvals-queue" ref={rootRef} tabIndex={-1}>
      <div className="approvals-head">
        <div>
          <div className="label">Approval queue</div>
          <h2>Pending actions</h2>
          <p>
            Tool calls gated by your policy wait here. Press <kbd>A</kbd> to approve the top item,
            <kbd>D</kbd> to deny it.
          </p>
        </div>
        <div className="approvals-actions">
          <div className="approvals-filter" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={filter === "pending"}
              className={`approvals-filter-btn${filter === "pending" ? " on" : ""}`}
              onClick={() => setFilter("pending")}
            >
              pending
              <span className="approvals-filter-count">{counts.pending}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filter === "all"}
              className={`approvals-filter-btn${filter === "all" ? " on" : ""}`}
              onClick={() => setFilter("all")}
            >
              all
              <span className="approvals-filter-count">{counts.total}</span>
            </button>
          </div>
          <button
            type="button"
            className="approvals-test-btn"
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey) createTestApproval();
            }}
            title="⌘-click to inject a test approval"
          >
            + Test
          </button>
        </div>
      </div>

      {loading ? (
        <div className="approvals-empty">Loading…</div>
      ) : approvals.length === 0 ? (
        <div className="approvals-empty approvals-empty--quiet">
          <div className="approvals-empty-mark">✓</div>
          <div className="approvals-empty-title">
            {filter === "pending" ? "Nothing waiting on you" : "No approvals on record"}
          </div>
          <div className="approvals-empty-body">
            {filter === "pending"
              ? "Gated tool calls show up here. The queue auto-refreshes."
              : "Once a tool call hits the gate it lands here."}
          </div>
        </div>
      ) : (
        <div className="approvals-list">
          {approvals.map((a) => {
            const risk = riskOf(a.tool_name);
            const isDenying = denyingId === a.id;
            return (
              <article
                key={a.id}
                className={`approval-card approval-card--${a.status} approval-card--risk-${risk}`}
              >
                <header>
                  <div className="approval-card-id">
                    <span className={`approval-risk approval-risk--${risk}`} title={`${risk} risk`}>
                      {risk === "system" ? "⚠" : risk === "mutating" ? "✎" : "·"}
                    </span>
                    <div>
                      <div className="approval-tool">{a.tool_name}</div>
                      <div className="approval-meta">
                        {new Date(a.created_at).toLocaleString()}
                        {a.thread_id && <span> · thread {a.thread_id.slice(0, 8)}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="approval-card-trailing">
                    {a.estimated_cost_usd !== null && (
                      <span className="approval-cost-chip">
                        ${a.estimated_cost_usd.toFixed(4)}
                      </span>
                    )}
                    <span className={`approval-status approval-status--${a.status}`}>{a.status}</span>
                  </div>
                </header>
                {a.reason && <p className="approval-reason">{a.reason}</p>}
                <ToolCallDiff toolName={a.tool_name} args={a.tool_args} />
                {a.status === "pending" && !isDenying && (
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
                      onClick={() => {
                        setDenyingId(a.id);
                        setDenyNote("");
                      }}
                    >
                      Deny
                    </button>
                  </footer>
                )}
                {a.status === "pending" && isDenying && (
                  <footer className="approval-deny-form">
                    <input
                      type="text"
                      autoFocus
                      className="approval-deny-input"
                      placeholder="Why are you denying this? (optional)"
                      value={denyNote}
                      onChange={(e) => setDenyNote(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void decide(a.id, "denied", denyNote.trim() || undefined);
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          setDenyingId(null);
                          setDenyNote("");
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="approval-btn approval-btn--deny"
                      onClick={() => decide(a.id, "denied", denyNote.trim() || undefined)}
                    >
                      Confirm deny
                    </button>
                    <button
                      type="button"
                      className="approval-btn approval-btn--cancel"
                      onClick={() => {
                        setDenyingId(null);
                        setDenyNote("");
                      }}
                    >
                      Cancel
                    </button>
                  </footer>
                )}
                {a.decision_note && (
                  <div className="approval-decision-note">
                    <span className="approval-decision-note-label">note</span>
                    <span>{a.decision_note}</span>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
