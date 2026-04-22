"use client";

/**
 * LocalSuggestionsStrip — "for your hardware, these local models fit."
 *
 * Reused in two places:
 *   - SystemTab: rendered once per modality as a cross-modality overview
 *   - ModalityTab: rendered above the universal leaderboard so users see
 *                  "what fits on MY machine" alongside "what's best overall"
 *
 * Install flow: clicking Pull issues POST /api/ollama/tags with the
 * candidate's ollamaTag — same endpoint ModelsPane uses for Ollama.
 */

import { useCallback, useEffect, useState } from "react";

type ModalityId =
  | "text"
  | "vision"
  | "image-gen"
  | "audio-gen"
  | "tts"
  | "stt"
  | "embedding"
  | "rerank"
  | "3d-gen"
  | "video-gen";

interface LocalCandidate {
  id: string;
  displayName: string;
  modality: ModalityId;
  providerId: string;
  ollamaTag?: string;
  hfRepo?: string;
  vramRequiredMB: number;
  diskMB: number;
  quantization: string;
  cpuFriendly: boolean;
  summary: string;
  family: string;
  license: string;
  source?: "huggingface-live" | "curated-fallback" | "user-installed";
  downloads?: number;
  likes?: number;
  leaderboardScore?: number;
  buzzScore?: number;
}

interface LocalSuggestion {
  candidate: LocalCandidate;
  fit: "perfect" | "tight" | "overhead-risk" | "too-big";
  installed: boolean;
  fillRatio: number;
  reasoning: string;
  installCommand?: string;
}

export function LocalSuggestionsStrip({
  modality,
  limit = 3,
  title = "For your hardware",
  refreshToken,
}: {
  modality: ModalityId;
  limit?: number;
  title?: string;
  refreshToken?: number;
}) {
  const [suggestions, setSuggestions] = useState<LocalSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [pulling, setPulling] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/inference/suggestions?modality=${modality}&limit=${limit}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const data = (await res.json()) as { suggestions?: LocalSuggestion[] };
      setSuggestions(data.suggestions ?? []);
    } finally {
      setLoading(false);
    }
  }, [modality, limit]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const pullModel = useCallback(
    async (ollamaTag: string) => {
      setPulling(ollamaTag);
      setMsg(`Pulling ${ollamaTag}…`);
      try {
        const res = await fetch("/api/ollama/tags", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: ollamaTag }),
        });
        if (!res.ok) throw new Error(`${res.status}`);
        setMsg(`Pulled ${ollamaTag}. Refreshing…`);
        await load();
      } catch (e) {
        setMsg(`Pull failed: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setPulling(null);
        setTimeout(() => setMsg(null), 4000);
      }
    },
    [load],
  );

  if (loading && suggestions.length === 0) {
    return <div className="local-strip-loading">Probing your hardware…</div>;
  }
  if (suggestions.length === 0) {
    return null;
  }

  return (
    <section className="local-strip">
      <div className="local-strip-head">
        <div className="label">{title}</div>
        {msg && <span className="local-strip-msg">{msg}</span>}
      </div>
      <div className="local-strip-cards">
        {suggestions.map((s) => (
          <article
            key={s.candidate.id}
            className={`local-card local-card--${s.fit}${s.installed ? " local-card--installed" : ""}`}
          >
            <div className="local-card-head">
              <span className="local-card-name">{s.candidate.displayName}</span>
              <FitBadge fit={s.fit} installed={s.installed} />
            </div>
            <div className="local-card-meta">
              <SourceBadge source={s.candidate.source} />
              <span className="inference-mono">{formatMB(s.candidate.vramRequiredMB)}</span>
              <span className="local-card-dot">·</span>
              <span className="inference-mono">{s.candidate.quantization}</span>
              <span className="local-card-dot">·</span>
              <span className="local-card-family">{s.candidate.family}</span>
              {s.candidate.downloads !== undefined && s.candidate.downloads > 0 && (
                <>
                  <span className="local-card-dot">·</span>
                  <span className="local-card-downloads">{formatDownloads(s.candidate.downloads)} dl</span>
                </>
              )}
            </div>
            <div className="local-card-fill">
              <div
                className={`local-card-fill-bar local-card-fill-bar--${s.fit}`}
                style={{ width: `${Math.min(100, s.fillRatio * 100)}%` }}
                aria-label={`${Math.round(s.fillRatio * 100)}% of capacity`}
              />
            </div>
            <p className="local-card-reason">{s.reasoning}</p>
            <div className="local-card-actions">
              {s.installed ? (
                <span className="local-card-installed-badge">Installed</span>
              ) : s.candidate.ollamaTag ? (
                <button
                  type="button"
                  className="inference-action-btn"
                  disabled={pulling === s.candidate.ollamaTag}
                  onClick={() => void pullModel(s.candidate.ollamaTag!)}
                  title={`ollama pull ${s.candidate.ollamaTag}`}
                >
                  {pulling === s.candidate.ollamaTag ? "Pulling…" : "Pull"}
                </button>
              ) : s.installCommand ? (
                <code className="local-card-cmd" title="Copy & run in a terminal">
                  {s.installCommand}
                </code>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function FitBadge({
  fit,
  installed,
}: {
  fit: LocalSuggestion["fit"];
  installed: boolean;
}) {
  if (installed) return <span className="local-fit local-fit--installed">READY</span>;
  const label = fit === "perfect" ? "Fits" : fit === "tight" ? "Tight" : "Risk";
  return <span className={`local-fit local-fit--${fit}`}>{label}</span>;
}

function formatMB(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return `${n}`;
}

function SourceBadge({ source }: { source: LocalCandidate["source"] }) {
  if (source === "huggingface-live") {
    return (
      <span className="local-source-badge local-source-badge--live" title="Live from HuggingFace Hub trending">
        LIVE
      </span>
    );
  }
  if (source === "curated-fallback") {
    return (
      <span className="local-source-badge local-source-badge--curated" title="Curated fallback entry">
        CURATED
      </span>
    );
  }
  return null;
}
