"use client";

/**
 * EngineLatencyCard — engine-level latency gates from the run ledger.
 *
 * Self-feeds from GET /api/agui/runs?aggregate=engine every 10s (the
 * useSystemStats cadence; the page-level hardware poll runs at 5s). Shows
 * TTFT and tool round-trip p50/p95, model resolve p50, and a per-provider
 * tag breakdown over the last 200 runs.
 *
 * Empty distributions render as an honest "not sampled" state — runs written
 * before LLMResolved landed carry no resolve signal, and a fresh ledger
 * carries no signal at all.
 */

import { useCallback, useEffect, useRef, useState } from "react";

interface Distribution {
  count: number;
  p50: number;
  p95: number;
  avg: number;
}

interface ProviderLatency {
  provider: string;
  runs: number;
  ttft: Distribution;
  toolRoundTrip: Distribution;
  resolve: Distribution;
}

interface EngineLatency {
  limit: number;
  runsSampled: number;
  runsTimed: number;
  ttft: Distribution;
  toolRoundTrip: Distribution;
  resolve: Distribution;
  providers: ProviderLatency[];
}

const POLL_MS = 10_000;
const EMPTY: Distribution = { count: 0, p50: 0, p95: 0, avg: 0 };

/** ms → { v, u } for the carved-cell big value + unit suffix. */
function splitMs(ms: number): { v: string; u: string } {
  if (!Number.isFinite(ms) || ms <= 0) return { v: "—", u: "" };
  if (ms < 1000) return { v: String(Math.round(ms)), u: "ms" };
  return { v: (ms / 1000).toFixed(1), u: "s" };
}

/** ms → compact inline label for notes and provider tags. */
function inlineMs(ms: number): string {
  const { v, u } = splitMs(ms);
  return u ? `${v}${u}` : v;
}

function LatencyCell(props: { k: string; dist: Distribution; note: string }) {
  const na = props.dist.count === 0;
  const { v, u } = splitMs(props.dist.p50);
  return (
    <div className="cell">
      <span className="k">{props.k}</span>
      <span className={`v${na ? " na" : ""}`}>
        {na ? "—" : v}
        {!na && (
          <i>
            {u} · p50
          </i>
        )}
      </span>
      <span className="note">{props.note}</span>
    </div>
  );
}

export function EngineLatencyCard() {
  const [data, setData] = useState<EngineLatency | null>(null);
  const [stale, setStale] = useState(false);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/agui/runs?aggregate=engine&limit=200", {
        cache: "no-store",
      });
      if (!r.ok) throw new Error(String(r.status));
      const d = (await r.json()) as EngineLatency;
      if (!alive.current) return;
      setData(d);
      setStale(false);
    } catch {
      if (alive.current) setStale(true);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => {
      alive.current = false;
      clearInterval(t);
    };
  }, [refresh]);

  const ttft = data?.ttft ?? EMPTY;
  const roundTrip = data?.toolRoundTrip ?? EMPTY;
  const resolve = data?.resolve ?? EMPTY;
  const scope = stale
    ? "reconnecting"
    : data
      ? `${data.runsTimed}/${data.runsSampled} runs timed · window ${data.limit}`
      : "connecting…";

  return (
    <section className="card lat">
      <div className="res-head">
        <span className="kicker">Engine latency</span>
        <span className="lat-scope">{scope}</span>
      </div>
      <div className="res-sub-id">from the run ledger · p50 / p95 over recent runs</div>
      <div className="lat-cells">
        <LatencyCell
          k="First token"
          dist={ttft}
          note={ttft.count > 0 ? `p95 ${inlineMs(ttft.p95)} · n=${ttft.count}` : "not sampled"}
        />
        <LatencyCell
          k="Tool round-trip"
          dist={roundTrip}
          note={
            roundTrip.count > 0
              ? `p95 ${inlineMs(roundTrip.p95)} · n=${roundTrip.count}`
              : "not sampled"
          }
        />
        <LatencyCell
          k="Model resolve"
          dist={resolve}
          note={resolve.count > 0 ? `n=${resolve.count}` : "not sampled"}
        />
      </div>
      {data && data.providers.length > 0 && (
        <div className="lat-provs">
          {data.providers.map((p) => (
            <span
              className="tag"
              key={p.provider}
              title={`${p.provider}: ${p.runs} run${p.runs === 1 ? "" : "s"} in window · tool round-trip p50 ${inlineMs(p.toolRoundTrip.p50)}`}
            >
              {p.provider} · {p.runs} run{p.runs === 1 ? "" : "s"} · ttft {inlineMs(p.ttft.p50)} ·
              resolve {p.resolve.count > 0 ? inlineMs(p.resolve.p50) : "—"}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
