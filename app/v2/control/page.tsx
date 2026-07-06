"use client";

/**
 * /v2/control — Atlas Visual 2 CONTROL surface: the approvals + policy deck.
 *
 * Two concerns, stacked:
 *   1. QUEUE — tool calls the approval gate is holding for sign-off. Each row
 *      shows the mono tool name, an args preview, a risk tag (from the tool
 *      manifest), age + run id, and Approve / Deny. Decisions POST to
 *      /api/agui/approvals { id, decision } — the same endpoint lib/approvals
 *      /gate.ts polls, so approving here releases a real waiting dispatch.
 *   2. POLICIES — standing switches. The first two are LIVE and persist to
 *      /api/settings: the approval gate (runs.autoExecuteTools) and confirm-
 *      every-tool (approval.defaultMode). The last two (sandbox, redact) are
 *      enforced by the runtime (code-exec sandbox, manifest arg redaction) and
 *      shown locked-on rather than as fake toggles.
 *
 * Real data:
 *   · GET  /api/agui/approvals?status=pending — live queue (polled 5s).
 *   · GET  /api/settings                      — approval + runs policy.
 *   · POST /api/agui/approvals { id, decision } — approve / deny.
 *   · PUT  /api/settings { section, value }     — persist a policy switch.
 * When the queue is empty we render a carved empty-state plus a couple of
 * clearly-marked sample rows so the design still reads.
 */

import { useCallback, useEffect, useState } from "react";
import { getManifest, type RiskLevel } from "@/lib/tools/manifest";
import "./control-v2.css";

/* ── risk → tone (mirrors /v2/tools) ─────────────────────────────────────── */
type Tone = "positive" | "caution" | "danger";
const RISK_TONE: Record<RiskLevel, Tone> = {
  read_only: "positive",
  low_write: "caution",
  medium_write: "caution",
  high_write: "danger",
  sensitive: "danger",
  dangerous: "danger",
};

/* ── types ───────────────────────────────────────────────────────────────── */
interface ApprovalView {
  id: string;
  toolName: string;
  args: unknown;
  reason: string | null;
  runId: string | null;
  createdAt: string;
  estimatedCostUsd: number | null;
  sample?: boolean;
}

/** Raw row shape from GET /api/agui/approvals (tool_args pre-parsed by route). */
interface ApprovalApiRow {
  id: string;
  tool_name: string;
  tool_args: unknown;
  reason: string | null;
  run_id: string | null;
  created_at: string;
  estimated_cost_usd: number | null;
}

interface PolicyState {
  gateOn: boolean; // approval gate active  (= runs.autoExecuteTools === false)
  confirmTools: boolean; // approval.defaultMode === "ask"
}

/* ── sample rows (shown only when the real queue is empty) ────────────────── */
const now = Date.now();
const SAMPLE_ROWS: ApprovalView[] = [
  {
    id: "sample-1",
    toolName: "execute_code",
    args: { language: "bash", code: "rm -rf ./.cache/*", timeout: 30000 },
    reason: "Gated by policy: side-effect",
    runId: "run_7f2a9c14",
    createdAt: new Date(now - 42_000).toISOString(),
    estimatedCostUsd: null,
    sample: true,
  },
  {
    id: "sample-2",
    toolName: "vector_ingest",
    args: { url: "https://docs.internal/api/v3", collection: "kb" },
    reason: "Gated by policy: ask",
    runId: "run_1b8e0d33",
    createdAt: new Date(now - 5 * 60_000).toISOString(),
    estimatedCostUsd: 0.004,
    sample: true,
  },
];

/* ── helpers ─────────────────────────────────────────────────────────────── */
function relTime(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function riskFor(toolName: string): { risk: RiskLevel; tone: Tone } {
  const risk = getManifest(toolName).risk;
  return { risk, tone: RISK_TONE[risk] };
}

/** Compact one-line args preview with accent-keyed keys. Truncated. */
function ArgsPreview({ args }: { args: unknown }) {
  if (args == null || (typeof args === "object" && Object.keys(args as object).length === 0)) {
    return <span className="empty">no arguments</span>;
  }
  if (typeof args !== "object") {
    return <>{truncate(String(args), 120)}</>;
  }
  const entries = Object.entries(args as Record<string, unknown>);
  return (
    <>
      {entries.map(([k, v], i) => (
        <span key={k}>
          <span className="k">{k}</span>
          {": "}
          {truncate(compactValue(v), 64)}
          {i < entries.length - 1 ? "   " : ""}
        </span>
      ))}
    </>
  );
}

function compactValue(v: unknown): string {
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}
function truncate(s: string, n: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > n ? flat.slice(0, n - 1) + "…" : flat;
}

/* ── page ────────────────────────────────────────────────────────────────── */
export default function ControlV2Page() {
  const [pending, setPending] = useState<ApprovalView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [policy, setPolicy] = useState<PolicyState>({ gateOn: false, confirmTools: false });
  const [policyLoaded, setPolicyLoaded] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  /* ---- live queue (polled) ---- */
  const refreshQueue = useCallback(async () => {
    try {
      const r = await fetch("/api/agui/approvals?status=pending", { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const data = (await r.json()) as { approvals?: ApprovalApiRow[] };
      const rows: ApprovalView[] = (data.approvals ?? []).map((a) => ({
        id: a.id,
        toolName: a.tool_name,
        args: a.tool_args,
        reason: a.reason,
        runId: a.run_id,
        createdAt: a.created_at,
        estimatedCostUsd: a.estimated_cost_usd,
      }));
      setPending(rows);
    } catch {
      // Leave the last-known queue in place; the empty-state fallback covers
      // a cold start so the surface never renders blank.
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refreshQueue();
    const t = setInterval(() => void refreshQueue(), 5000);
    return () => clearInterval(t);
  }, [refreshQueue]);

  /* ---- policy (loaded once) ---- */
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/settings", { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const s = (await r.json()) as {
          runs?: { autoExecuteTools?: boolean };
          approval?: { defaultMode?: string };
        };
        setPolicy({
          gateOn: s.runs?.autoExecuteTools === false,
          confirmTools: s.approval?.defaultMode === "ask",
        });
      } catch {
        /* keep defaults */
      } finally {
        setPolicyLoaded(true);
      }
    })();
  }, []);

  /* ---- decide ---- */
  const decide = useCallback(
    async (id: string, decision: "approved" | "denied") => {
      setBusy((b) => ({ ...b, [id]: true }));
      setFlash(null);
      try {
        const r = await fetch("/api/agui/approvals", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id, decision }),
        });
        if (!r.ok) throw new Error(String(r.status));
        setPending((p) => p.filter((a) => a.id !== id));
      } catch {
        setFlash("Could not record the decision — the gate may have timed out. Retry.");
        void refreshQueue();
      } finally {
        setBusy((b) => {
          const next = { ...b };
          delete next[id];
          return next;
        });
      }
    },
    [refreshQueue],
  );

  /* ---- persist a live policy switch ---- */
  const writePolicy = useCallback(
    async (section: "runs" | "approval", value: Record<string, unknown>, revert: () => void) => {
      setFlash(null);
      try {
        const r = await fetch("/api/settings", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ section, value }),
        });
        if (!r.ok) throw new Error(String(r.status));
      } catch {
        revert();
        setFlash("Could not save that policy change.");
      }
    },
    [],
  );

  const toggleGate = useCallback(() => {
    const next = !policy.gateOn;
    setPolicy((p) => ({ ...p, gateOn: next }));
    // gate ON  ⇔ auto-execute OFF
    void writePolicy("runs", { autoExecuteTools: !next }, () =>
      setPolicy((p) => ({ ...p, gateOn: !next })),
    );
  }, [policy.gateOn, writePolicy]);

  const toggleConfirm = useCallback(() => {
    const next = !policy.confirmTools;
    setPolicy((p) => ({ ...p, confirmTools: next }));
    void writePolicy("approval", { defaultMode: next ? "ask" : "never" }, () =>
      setPolicy((p) => ({ ...p, confirmTools: !next })),
    );
  }, [policy.confirmTools, writePolicy]);

  /* ---- derived ---- */
  const isEmpty = loaded && pending.length === 0;
  const rows = isEmpty ? SAMPLE_ROWS : pending;
  const pendingCount = pending.length;
  const gateLabel = !policyLoaded ? "…" : policy.gateOn ? "ON" : "OFF";

  return (
    <div className="av2-control">
      <div className="wrap">
        {/* ── hero ── */}
        <header className="hero">
          <div className="hero-lede">
            <span className="kicker">Control deck · approvals</span>
            <h1>Control</h1>
            <p>
              Tool calls the agent wants to make land here first. Approve to release the waiting
              dispatch, deny to block it. Standing policies below decide what has to stop for
              sign-off at all.
            </p>
          </div>
          <div className="hstats">
            <div className="hstat">
              <span className={"hstat__n" + (pendingCount > 0 ? " is-live" : "")}>
                {loaded ? pendingCount : "—"}
              </span>
              <span className="hstat__l">pending</span>
            </div>
            <div className="hstat">
              <span className="hstat__n">{gateLabel}</span>
              <span className="hstat__l">gate</span>
            </div>
          </div>
        </header>

        {flash && <div className="flash">{flash}</div>}

        {/* ── queue ── */}
        <section className="section" aria-label="Pending approvals">
          <div className="sec-label">
            Queue<span className="sec-label__n">{loaded ? pendingCount : ""}</span>
            {isEmpty && <span className="sec-label__note">clear</span>}
          </div>

          {isEmpty && (
            <>
              <div className="card card--well empty">
                <span className="empty__mark ic" aria-hidden>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}
                    strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    <path d="M9 12l2 2 4-4" />
                  </svg>
                </span>
                <h3>Queue clear</h3>
                <p>No tool calls are waiting on you. New approvals appear here the moment the gate
                  holds one.</p>
              </div>
              <div className="sample-note">Sample — what a pending call looks like</div>
            </>
          )}

          <div className="queue">
            {rows.map((a) => {
              const { risk, tone } = riskFor(a.toolName);
              const isBusy = !!busy[a.id];
              const sample = !!a.sample;
              return (
                <article
                  key={a.id}
                  className={"card appr" + (sample ? " appr--sample" : "") + (isBusy ? " is-busy" : "")}
                >
                  <div className="appr__main">
                    <div className="appr__head">
                      <span className="appr__name">{a.toolName}</span>
                      <span className={"tag tag--status tag--" + tone}>{risk.replace("_", " ")}</span>
                      {sample && <span className="tag">sample</span>}
                    </div>
                    <div className="card card--well appr__args">
                      <ArgsPreview args={a.args} />
                    </div>
                    <div className="appr__meta">
                      {a.reason && <span className="appr__reason">{a.reason}</span>}
                      {a.reason && <span className="dot" />}
                      <span>{relTime(a.createdAt)}</span>
                      {a.runId && <span className="dot" />}
                      {a.runId && <span>{a.runId}</span>}
                      {typeof a.estimatedCostUsd === "number" && <span className="dot" />}
                      {typeof a.estimatedCostUsd === "number" && (
                        <span>~${a.estimatedCostUsd.toFixed(3)}</span>
                      )}
                    </div>
                  </div>
                  <div className="appr__act">
                    <button
                      className="btn btn--danger"
                      onClick={() => decide(a.id, "denied")}
                      disabled={sample || isBusy}
                    >
                      Deny
                    </button>
                    <button
                      className="btn btn--primary"
                      onClick={() => decide(a.id, "approved")}
                      disabled={sample || isBusy}
                    >
                      Approve
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {/* ── standing policies ── */}
        <section className="section" aria-label="Standing policies">
          <div className="sec-label">
            Standing policies
            <span className="sec-label__note">what has to stop for sign-off</span>
          </div>
          <div className="card pol">
            <PolicyRow
              title="Approval gate"
              code="runs.autoExecuteTools"
              desc="Master switch. When on, every gated tool call stops here instead of auto-running."
              checked={policy.gateOn}
              onToggle={toggleGate}
              disabled={!policyLoaded}
            />
            <PolicyRow
              title="Confirm every tool"
              code="approval.defaultMode = ask"
              desc="Ask before any tool runs, regardless of risk. Off falls back to the per-tool matrix."
              checked={policy.confirmTools}
              onToggle={toggleConfirm}
              disabled={!policyLoaded}
            />
            <PolicyRow
              title="Sandbox code execution"
              desc="execute_code always runs inside an isolated sandbox — no host filesystem or network."
              checked
              enforced
            />
            <PolicyRow
              title="Redact secrets in logs"
              desc="Tokens, keys and other sensitive args are masked by the manifest before they reach the transcript."
              checked
              enforced
            />
          </div>
        </section>
      </div>
    </div>
  );
}

/* ── policy row ──────────────────────────────────────────────────────────── */
function PolicyRow({
  title,
  code,
  desc,
  checked,
  onToggle,
  disabled,
  enforced,
}: {
  title: string;
  code?: string;
  desc: string;
  checked: boolean;
  onToggle?: () => void;
  disabled?: boolean;
  enforced?: boolean;
}) {
  return (
    <div className="pol__row">
      <div className="pol__txt">
        <div className="pol__title">
          {title}
          {code && <code>{code}</code>}
          {enforced && <span className="tag tag--accent">enforced</span>}
        </div>
        <div className="pol__desc">{desc}</div>
      </div>
      <label className="ctl">
        <input
          type="checkbox"
          checked={checked}
          disabled={enforced || disabled}
          onChange={onToggle}
        />
        <span className="ctl__track" />
      </label>
    </div>
  );
}
