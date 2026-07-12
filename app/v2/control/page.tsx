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
 * No fabricated data: an unreachable approvals API renders an explicit error +
 * retry (never a false "queue clear"), and a failed policy read leaves the
 * switches disabled with a retry rather than presenting defaults as fact.
 */

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ToolCatalog } from "./ToolCatalog";
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
function ControlV2Inner() {
  // D3: the static tool catalog folded in as a tab (?tab=tools).
  const searchParams = useSearchParams();
  const router = useRouter();
  const tab = searchParams.get("tab") === "tools" ? "tools" : "approvals";
  const setTab = useCallback((t: "approvals" | "tools") => {
    router.replace(t === "tools" ? "/v2/control?tab=tools" : "/v2/control", { scroll: false });
  }, [router]);
  const [pending, setPending] = useState<ApprovalView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [reachable, setReachable] = useState(true); // approvals API reachable
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [policy, setPolicy] = useState<PolicyState>({ gateOn: false, confirmTools: false });
  const [policyLoaded, setPolicyLoaded] = useState(false);
  const [policyError, setPolicyError] = useState(false);
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
      setReachable(true);
    } catch {
      // Backend unreachable — surface it honestly rather than rendering an empty
      // queue that a down API would be indistinguishable from.
      setReachable(false);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refreshQueue();
    const t = setInterval(() => void refreshQueue(), 5000);
    return () => clearInterval(t);
  }, [refreshQueue]);

  /* ---- policy (loaded once, retryable) ---- */
  const loadPolicy = useCallback(async () => {
    setPolicyError(false);
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
      setPolicyLoaded(true);
    } catch {
      // Never present unread defaults as loaded truth — a blind toggle write from
      // a wrong baseline can invert the intended policy. Keep switches disabled.
      setPolicyError(true);
    }
  }, []);

  useEffect(() => {
    void loadPolicy();
  }, [loadPolicy]);

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
  const showUnreachable = loaded && !reachable;
  const isEmpty = loaded && reachable && pending.length === 0;
  const pendingCount = pending.length;
  const pendingLabel = !loaded || !reachable ? "—" : pendingCount;
  const gateLabel = policyError ? "—" : !policyLoaded ? "…" : policy.gateOn ? "ON" : "OFF";

  return (
    <div className="av2-control">
      <div className="wrap">
        {/* ── quiet masthead — surface name + live readouts (no hero) ── */}
        <header className="masthead">
          <span className="mast-name">Control</span>
          <nav className="mast-tabs" aria-label="Control sections">
            <button type="button" className={"mast-tab" + (tab === "approvals" ? " is-active" : "")} onClick={() => setTab("approvals")}>approvals</button>
            <button type="button" className={"mast-tab" + (tab === "tools" ? " is-active" : "")} onClick={() => setTab("tools")}>tools</button>
          </nav>
          <div className="mast-side">
            <span className="mstat">
              <b className={reachable && pendingCount > 0 ? "is-live" : ""}>{pendingLabel}</b> pending
            </span>
            <span className="mstat">
              <b>{gateLabel}</b> gate
            </span>
          </div>
        </header>

        {flash && <div className="flash">{flash}</div>}

        {tab === "tools" ? <ToolCatalog /> : null}

        {tab === "tools" ? null : (
        <>
        {/* ── queue ── */}
        <section className="section" aria-label="Pending approvals">
          <div className="sec-label">
            Queue<span className="sec-label__n">{loaded && reachable ? pendingCount : ""}</span>
            {isEmpty && <span className="sec-label__note">clear</span>}
          </div>

          {showUnreachable && (
            <div className="card card--well empty empty--error">
              <span className="empty__mark ic" aria-hidden>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}
                  strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <path d="M12 9v4M12 17h.01" />
                </svg>
              </span>
              <h3>Approvals API unreachable</h3>
              <p>The gate can&rsquo;t be read right now, so pending calls can&rsquo;t be shown.
                Retrying every 5s.</p>
              <button type="button" className="btn" onClick={() => void refreshQueue()}>retry</button>
            </div>
          )}

          {isEmpty && (
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
          )}

          <div className="queue">
            {pending.map((a) => {
              const { risk, tone } = riskFor(a.toolName);
              const isBusy = !!busy[a.id];
              return (
                <article
                  key={a.id}
                  className={"card appr" + (isBusy ? " is-busy" : "")}
                >
                  <div className="appr__main">
                    <div className="appr__head">
                      <span className="appr__name">{a.toolName}</span>
                      <span className={"tag tag--status tag--" + tone}>{risk.replace("_", " ")}</span>
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
                      disabled={isBusy}
                    >
                      Deny
                    </button>
                    <button
                      className="btn btn--primary"
                      onClick={() => decide(a.id, "approved")}
                      disabled={isBusy}
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
          {policyError && (
            <div className="errline">
              Couldn&rsquo;t read the policy — the settings API didn&rsquo;t respond, so the switches
              stay locked to avoid writing from a wrong baseline.{" "}
              <button type="button" className="linkbtn" onClick={() => void loadPolicy()}>retry</button>
            </div>
          )}
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
        </>
        )}
      </div>
    </div>
  );
}

/* useSearchParams requires a Suspense boundary in the app router. */
export default function ControlV2Page() {
  return (
    <Suspense fallback={null}>
      <ControlV2Inner />
    </Suspense>
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
