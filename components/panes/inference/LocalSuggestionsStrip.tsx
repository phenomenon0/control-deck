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

import { useCallback, useEffect, useRef, useState } from "react";
import { useModelPull } from "@/lib/hooks/useModelPull";

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

type StorageFit =
  | { status: "ample" }
  | { status: "tight"; freeAfterGb: number }
  | { status: "needs-cleanup"; shortfallGb: number }
  | { status: "impossible"; requiredGb: number }
  | { status: "unknown" };

interface LocalSuggestion {
  candidate: LocalCandidate;
  fit: "perfect" | "tight" | "overhead-risk" | "too-big";
  installed: boolean;
  fillRatio: number;
  reasoning: string;
  installCommand?: string;
  storage: StorageFit;
}

export function LocalSuggestionsStrip({
  modality,
  limit = 3,
  title = "For your hardware",
  refreshToken,
  showAll = false,
}: {
  modality: ModalityId;
  limit?: number;
  title?: string;
  refreshToken?: number;
  /**
   * When true, fetch with filter=local-sota so the strip shows candidates
   * that exceed the user's VRAM alongside the ones that fit — marked with
   * a "needs N GB VRAM" badge. Useful for the "Local SOTA" System-tab pill.
   */
  showAll?: boolean;
}) {
  const [suggestions, setSuggestions] = useState<LocalSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const { pull: startPull, abort: abortPull, progressFor } = useModelPull();
  const seenDoneRef = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        modality,
        limit: String(limit),
      });
      if (showAll) qs.set("filter", "local-sota");
      const res = await fetch(`/api/inference/suggestions?${qs.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as { suggestions?: LocalSuggestion[] };
      setSuggestions(data.suggestions ?? []);
    } finally {
      setLoading(false);
    }
  }, [modality, limit, showAll]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const pullModel = useCallback(
    (ollamaTag: string) => {
      setMsg(`Pulling ${ollamaTag}…`);
      void startPull(ollamaTag);
    },
    [startPull],
  );

  // When any candidate's pull transitions to "done", refresh the list so
  // the card flips to "Installed" without a manual reload.
  useEffect(() => {
    for (const s of suggestions) {
      const tag = s.candidate.ollamaTag;
      if (!tag) continue;
      const prog = progressFor(tag);
      if (prog?.phase === "done" && !seenDoneRef.current.has(tag)) {
        seenDoneRef.current.add(tag);
        setMsg(`Pulled ${tag}. Refreshing…`);
        void load();
        setTimeout(() => setMsg(null), 4000);
      } else if (prog?.phase === "error" && !seenDoneRef.current.has(`err:${tag}`)) {
        seenDoneRef.current.add(`err:${tag}`);
        setMsg(`Pull failed: ${prog.error ?? "unknown"}`);
        setTimeout(() => setMsg(null), 5000);
      }
    }
  }, [suggestions, progressFor, load]);

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
            className={`local-card local-card--${s.fit}${s.installed ? " local-card--installed" : ""}${s.fit === "too-big" ? " local-card--oversized" : ""}`}
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
            {s.fit === "too-big" && (
              <div
                className="storage-chip storage-chip--needs-cleanup"
                title="This model's weights exceed your GPU / unified memory budget"
              >
                <span className="storage-chip-icon">⚠</span>
                <span>
                  Needs <strong>{formatMB(s.candidate.vramRequiredMB)}</strong> VRAM
                </span>
              </div>
            )}
            <StorageChip storage={s.storage} />
            <div className="local-card-actions">
              {s.installed ? (
                <span className="local-card-installed-badge">Installed</span>
              ) : s.candidate.ollamaTag ? (
                (() => {
                  const tag = s.candidate.ollamaTag!;
                  const prog = progressFor(tag);
                  const pulling = prog?.phase === "pulling" || prog?.phase === "queued";
                  if (pulling && prog) {
                    return (
                      <div className="local-card-pull-progress">
                        <div className="local-card-pull-bar">
                          <div
                            className="local-card-pull-bar-fill"
                            style={{ width: `${Math.round(prog.overallPct)}%` }}
                          />
                        </div>
                        <div className="local-card-pull-meta">
                          <span>{Math.round(prog.overallPct)}%</span>
                          <button
                            type="button"
                            className="local-card-pull-abort"
                            onClick={() => abortPull(tag)}
                            aria-label="Cancel pull"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <button
                      type="button"
                      className="inference-action-btn"
                      disabled={
                        s.storage.status === "needs-cleanup" ||
                        s.fit === "too-big"
                      }
                      onClick={() => pullModel(tag)}
                      title={
                        s.fit === "too-big"
                          ? `Exceeds your VRAM budget — won't run on this machine`
                          : s.storage.status === "needs-cleanup"
                            ? `Free ${(s.storage as Extract<StorageFit, { status: "needs-cleanup" }>).shortfallGb} GB before pulling`
                            : `ollama pull ${tag}`
                      }
                    >
                      {s.fit === "too-big"
                        ? "Beyond this PC"
                        : s.storage.status === "needs-cleanup"
                          ? "Free space first"
                          : "Pull"}
                    </button>
                  );
                })()
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
  const label =
    fit === "perfect"
      ? "Fits"
      : fit === "tight"
        ? "Tight"
        : fit === "overhead-risk"
          ? "Risk"
          : "Beyond";
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

function StorageChip({ storage }: { storage: StorageFit }) {
  if (storage.status === "ample" || storage.status === "unknown") return null;
  if (storage.status === "tight") {
    return (
      <div
        className="storage-chip storage-chip--tight"
        title="Leaves very little free disk after install"
      >
        <span className="storage-chip-icon">⚠</span>
        <span>Tight — {storage.freeAfterGb} GB left after pull</span>
      </div>
    );
  }
  if (storage.status === "needs-cleanup") {
    return (
      <div
        className="storage-chip storage-chip--needs-cleanup"
        title="You need to free disk space before this can be installed"
      >
        <span className="storage-chip-icon">⚠</span>
        <span>Free <strong>{storage.shortfallGb} GB</strong> to install</span>
      </div>
    );
  }
  return null;
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
