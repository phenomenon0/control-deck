"use client";

/**
 * TierPicker — three-card hardware-tier bundle installer.
 *
 * Lives at the top of the Hardware pane, above ModalityGlance. Calls
 * `GET /api/voice/bundles` for state + recommendation, and
 * `POST /api/voice/bundles` to start a one-click pull of the bundle's
 * STT + TTS + LLM (and optional omni). Streams NDJSON progress per model
 * into a tiny per-row bar.
 *
 * State machine per card: idle → pulling → done | error.
 * "done" doesn't lock the card — it's still re-pullable, since users may
 * want to overwrite or add the omni lane after the cascade lands.
 */

import { useCallback, useEffect, useRef, useState } from "react";

type SourceTag = "ollama" | "voice-engines" | "qwen-omni";

interface BundleLane {
  id: string;
  label: string;
  sizeMb: number | null;
  note: string | null;
  available?: boolean;
  loaded?: boolean;
  installed?: boolean;
}

interface BundleOmni {
  engineId: string;
  label: string;
  sidecar: SourceTag;
  modelId: string;
  sizeMb: number;
  note: string;
  installed: boolean;
}

interface BundleTier {
  id: "T1_MAC" | "T2_CUDA" | "T3_CPU";
  label: string;
  hardwareMatch: string;
  rationale: string;
  defaultPreset: string;
  diskMb: { cascade: number; withOmni: number | null };
  cascade: { stt: BundleLane; tts: BundleLane; llm: BundleLane };
  omni: BundleOmni | null;
  score: number;
  recommended: boolean;
  boundAsPrimary: boolean;
}

interface BundleApiResponse {
  profile: { backend: string; gpu: { name?: string } | null; ramGb: number };
  recommendation: { best: string };
  selected: { tier: string | undefined; omni: boolean };
  tiers: BundleTier[];
  sidecar: { url: string; reachable: boolean };
}

interface RowProgress {
  source: SourceTag;
  model: string;
  pct: number;
  status: string;
  error?: string;
}

interface CardState {
  phase: "idle" | "pulling" | "done" | "error";
  rows: Map<string, RowProgress>;
  error?: string;
  omniRequested: boolean;
}

const EMPTY_CARD_STATE: CardState = {
  phase: "idle",
  rows: new Map(),
  omniRequested: false,
};

export function TierPicker() {
  const [data, setData] = useState<BundleApiResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cards, setCards] = useState<Record<string, CardState>>({});
  const abortersRef = useRef<Map<string, AbortController>>(new Map());

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/voice/bundles", { cache: "no-store" });
      if (!res.ok) {
        setLoadError(`bundles api returned ${res.status}`);
        return;
      }
      const body = (await res.json()) as BundleApiResponse;
      setData(body);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "load failed");
    }
  }, []);

  useEffect(() => {
    refresh();
    return () => {
      // Abort any in-flight pulls when the picker unmounts.
      for (const ctrl of abortersRef.current.values()) ctrl.abort();
      abortersRef.current.clear();
    };
  }, [refresh]);

  const startPull = useCallback(
    async (tierId: string, omni: boolean) => {
      const existing = abortersRef.current.get(tierId);
      if (existing) existing.abort();
      const ctrl = new AbortController();
      abortersRef.current.set(tierId, ctrl);

      setCards((prev) => ({
        ...prev,
        [tierId]: {
          phase: "pulling",
          rows: new Map(),
          omniRequested: omni,
        },
      }));

      try {
        const res = await fetch("/api/voice/bundles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tierId, omni }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          const text = await res.text().catch(() => "");
          throw new Error(text || `bundles POST ${res.status}`);
        }
        await consumeNdjson(res.body, (line) => {
          setCards((prev) => applyLine(prev, tierId, line));
        });
        setCards((prev) => {
          const next = { ...prev };
          const cur = next[tierId];
          if (cur && cur.phase === "pulling") {
            next[tierId] = { ...cur, phase: "done" };
          }
          return next;
        });
        await refresh();
      } catch (err) {
        if (ctrl.signal.aborted) {
          setCards((prev) => {
            const next = { ...prev };
            delete next[tierId];
            return next;
          });
          return;
        }
        const msg = err instanceof Error ? err.message : "pull failed";
        setCards((prev) => ({
          ...prev,
          [tierId]: {
            ...(prev[tierId] ?? EMPTY_CARD_STATE),
            phase: "error",
            error: msg,
          },
        }));
      } finally {
        abortersRef.current.delete(tierId);
      }
    },
    [refresh],
  );

  const cancelPull = useCallback((tierId: string) => {
    const ctrl = abortersRef.current.get(tierId);
    if (ctrl) ctrl.abort();
  }, []);

  if (loadError) {
    return (
      <section className="tier-picker tier-picker--error" aria-label="Hardware tier bundles">
        <div className="tier-picker-head">
          <span className="tier-picker-title">Hardware bundles</span>
          <span className="tier-picker-meta">unavailable: {loadError}</span>
        </div>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="tier-picker tier-picker--loading" aria-label="Hardware tier bundles">
        <div className="tier-picker-head">
          <span className="tier-picker-title">Hardware bundles</span>
          <span className="tier-picker-meta">loading…</span>
        </div>
      </section>
    );
  }

  return (
    <section className="tier-picker" aria-label="Hardware tier bundles">
      <header className="tier-picker-head">
        <span className="tier-picker-title">Hardware bundles</span>
        <span className="tier-picker-meta">
          Detected · {data.profile.backend.toUpperCase()}
          {data.profile.gpu?.name ? ` · ${data.profile.gpu.name}` : ""} · {data.profile.ramGb} GB RAM
          {!data.sidecar.reachable && (
            <span className="tier-picker-warn"> · sidecar offline (port 9101)</span>
          )}
        </span>
      </header>

      <div className="tier-picker-grid">
        {data.tiers.map((tier) => {
          const state = cards[tier.id] ?? EMPTY_CARD_STATE;
          return (
            <TierCard
              key={tier.id}
              tier={tier}
              selectedTierId={data.selected.tier ?? null}
              state={state}
              onPull={(omni) => startPull(tier.id, omni)}
              onCancel={() => cancelPull(tier.id)}
            />
          );
        })}
      </div>
    </section>
  );
}

function TierCard({
  tier,
  selectedTierId,
  state,
  onPull,
  onCancel,
}: {
  tier: BundleTier;
  selectedTierId: string | null;
  state: CardState;
  onPull: (omni: boolean) => void;
  onCancel: () => void;
}) {
  const [omniOn, setOmniOn] = useState<boolean>(false);
  const isSelected = selectedTierId === tier.id;
  const installed =
    Boolean(tier.cascade.stt.available) &&
    Boolean(tier.cascade.tts.available) &&
    Boolean(tier.cascade.llm.installed);

  const cardClass = [
    "tier-card",
    tier.recommended ? "tier-card--recommended" : "",
    isSelected ? "tier-card--selected" : "",
    installed ? "tier-card--installed" : "",
    state.phase === "pulling" ? "tier-card--pulling" : "",
    state.phase === "error" ? "tier-card--error" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={cardClass}>
      <header className="tier-card-head">
        <div className="tier-card-title-row">
          <span className="tier-card-title">{tier.label}</span>
          {tier.recommended && <span className="tier-card-badge">Recommended</span>}
          {!tier.recommended && tier.score >= 60 && (
            <span className="tier-card-badge tier-card-badge--alt">Will run</span>
          )}
          {!tier.recommended && tier.score < 60 && (
            <span className="tier-card-badge tier-card-badge--warn">May be slow</span>
          )}
          {isSelected && <span className="tier-card-badge tier-card-badge--ok">Active</span>}
        </div>
        <div className="tier-card-match">{tier.hardwareMatch}</div>
      </header>

      <ul className="tier-card-lanes">
        <Lane
          label="STT"
          modelLabel={tier.cascade.stt.label}
          sizeMb={tier.cascade.stt.sizeMb}
          installed={tier.cascade.stt.available ?? false}
          progress={state.rows.get(tier.cascade.stt.id)}
        />
        <Lane
          label="TTS"
          modelLabel={tier.cascade.tts.label}
          sizeMb={tier.cascade.tts.sizeMb}
          installed={tier.cascade.tts.available ?? false}
          progress={state.rows.get(tier.cascade.tts.id)}
        />
        <Lane
          label="LLM"
          modelLabel={tier.cascade.llm.label}
          sizeMb={tier.cascade.llm.sizeMb}
          installed={tier.cascade.llm.installed ?? false}
          progress={state.rows.get(tier.cascade.llm.id)}
        />
        {tier.omni && (
          <li className="tier-card-omni">
            <label className="tier-card-omni-toggle">
              <input
                type="checkbox"
                checked={omniOn}
                disabled={state.phase === "pulling"}
                onChange={(e) => setOmniOn(e.target.checked)}
              />
              <span className="tier-card-omni-label">+ Omni · {tier.omni.label}</span>
            </label>
            <div className="tier-card-omni-note">{tier.omni.note}</div>
            {omniOn && state.rows.has(tier.omni.modelId) && (
              <ProgressBar progress={state.rows.get(tier.omni.modelId)} />
            )}
          </li>
        )}
      </ul>

      <footer className="tier-card-foot">
        <span className="tier-card-disk">
          {formatGb(omniOn && tier.diskMb.withOmni ? tier.diskMb.withOmni : tier.diskMb.cascade)}
        </span>
        {state.phase === "pulling" ? (
          <button type="button" className="hardware-btn hardware-btn--ghost" onClick={onCancel}>
            Cancel
          </button>
        ) : (
          <button
            type="button"
            className="hardware-btn"
            onClick={() => onPull(omniOn)}
          >
            {installed && state.phase !== "error"
              ? omniOn
                ? "Add omni"
                : "Re-pull"
              : "Pull bundle"}
          </button>
        )}
      </footer>

      {state.phase === "error" && state.error && (
        <div className="tier-card-error">{state.error}</div>
      )}
    </article>
  );
}

function Lane({
  label,
  modelLabel,
  sizeMb,
  installed,
  progress,
}: {
  label: string;
  modelLabel: string;
  sizeMb: number | null;
  installed: boolean;
  progress: RowProgress | undefined;
}) {
  return (
    <li className="tier-card-lane">
      <div className="tier-card-lane-head">
        <span className="tier-card-lane-tag">{label}</span>
        <span className="tier-card-lane-name">{modelLabel}</span>
        <span className="tier-card-lane-size">
          {installed ? "✓" : sizeMb ? formatMb(sizeMb) : ""}
        </span>
      </div>
      {progress && <ProgressBar progress={progress} />}
    </li>
  );
}

function ProgressBar({ progress }: { progress: RowProgress | undefined }) {
  if (!progress) return null;
  if (progress.error) {
    return (
      <div className="tier-card-row-error">{progress.status}: {progress.error}</div>
    );
  }
  return (
    <div className="tier-card-row-bar">
      <div
        className="tier-card-row-bar-fill"
        style={{ width: `${Math.round(progress.pct)}%` }}
      />
      <span className="tier-card-row-bar-meta">
        {Math.round(progress.pct)}% · {progress.status}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NDJSON consumption + line→state reducer.

interface BundleLine {
  source?: SourceTag;
  model?: string;
  status?: string;
  digest?: string;
  total?: number;
  completed?: number;
  error?: string;
  phase?: string;
}

async function consumeNdjson(
  body: ReadableStream<Uint8Array>,
  onLine: (line: BundleLine) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl = buf.indexOf("\n");
    while (nl !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) {
        try {
          onLine(JSON.parse(line) as BundleLine);
        } catch {
          /* ignore garbage */
        }
      }
      nl = buf.indexOf("\n");
    }
  }
  const tail = buf.trim();
  if (tail) {
    try {
      onLine(JSON.parse(tail) as BundleLine);
    } catch {
      /* ignore */
    }
  }
}

function applyLine(
  prev: Record<string, CardState>,
  tierId: string,
  line: BundleLine,
): Record<string, CardState> {
  const cur = prev[tierId] ?? EMPTY_CARD_STATE;
  // Phase frames carry only `phase` — they're status hints, not row updates.
  if (line.phase === "error") {
    return {
      ...prev,
      [tierId]: { ...cur, phase: "error", error: line.error ?? "pull failed" },
    };
  }
  if (line.phase === "done" || line.phase === "bound") {
    // Tier-level success — leave rows alone, mark phase done in caller.
    return prev;
  }
  if (!line.model || !line.source) return prev;

  const rows = new Map(cur.rows);
  const existing = rows.get(line.model);
  const status = line.error ? "error" : line.status ?? existing?.status ?? "";
  const total = line.total ?? 0;
  const completed = line.completed ?? 0;
  let pct = existing?.pct ?? 0;
  if (line.status === "success") pct = 100;
  else if (total > 0) pct = Math.max(pct, Math.min(100, (completed / total) * 100));

  rows.set(line.model, {
    source: line.source,
    model: line.model,
    pct,
    status,
    error: line.error,
  });

  return {
    ...prev,
    [tierId]: { ...cur, rows },
  };
}

function formatMb(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

function formatGb(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB total`;
  return `${mb} MB total`;
}
