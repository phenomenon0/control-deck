"use client";

/**
 * CatalogMiniGrid — compact "discover local models" grid sized for the
 * RoutePicker popover. Queries /api/inference/suggestions (text modality)
 * and overlays live pull progress from useModelPull so starting a pull
 * here syncs with every other surface.
 */

import { useCallback, useEffect, useState } from "react";
import { Check, Download, Loader2, RotateCw, X } from "lucide-react";

import { useModelPull, type PullProgress } from "@/lib/hooks/useModelPull";

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

interface Props {
  modality?: ModalityId;
  limit?: number;
  /** Which installed tag is currently selected — used for the "Switch" state. */
  activeTag?: string;
  onPick: (tag: string) => void;
  /** Fires after a pull completes so the parent can refresh the installed list. */
  onPulled?: (tag: string) => void;
}

export function CatalogMiniGrid({
  modality = "text",
  limit = 10,
  activeTag,
  onPick,
  onPulled,
}: Props) {
  const [suggestions, setSuggestions] = useState<LocalSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const { pull, abort, progressFor } = useModelPull();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ modality, limit: String(limit) });
      const res = await fetch(`/api/inference/suggestions?${qs.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as { suggestions?: LocalSuggestion[] };
      setSuggestions(data.suggestions ?? []);
    } finally {
      setLoading(false);
    }
  }, [modality, limit]);

  useEffect(() => {
    void load();
  }, [load]);

  // When a pull completes, refresh the suggestion list once per tag so
  // `installed` flips to true. Latches per-tag via a ref so a finished
  // pull that stays in the store doesn't retrigger on every render.
  const seenDone = useState(() => new Set<string>())[0];
  useEffect(() => {
    const ids = suggestions
      .map((s) => s.candidate.ollamaTag)
      .filter((t): t is string => Boolean(t));
    for (const tag of ids) {
      const p = progressFor(tag);
      if (p?.phase === "done" && !seenDone.has(tag)) {
        seenDone.add(tag);
        onPulled?.(tag);
        void load();
      }
    }
  }, [suggestions, progressFor, onPulled, load, seenDone]);

  if (loading && suggestions.length === 0) {
    return <p className="composer-mini-hint">Probing hardware…</p>;
  }
  if (suggestions.length === 0) {
    return <p className="composer-mini-hint">No suggestions — system probe failed.</p>;
  }

  return (
    <ul className="composer-mini-grid">
      {suggestions.map((s) => {
        const tag = s.candidate.ollamaTag;
        const prog = tag ? progressFor(tag) : undefined;
        const isActive = activeTag === tag;
        return (
          <li
            key={s.candidate.id}
            className={`composer-mini-card composer-mini-card--${s.fit}${s.installed ? " is-installed" : ""}${isActive ? " is-active" : ""}`}
          >
            <div className="composer-mini-head">
              <span className="composer-mini-name">{s.candidate.displayName}</span>
              <FitChip fit={s.fit} installed={s.installed} />
            </div>
            <div className="composer-mini-meta">
              <span>{formatMB(s.candidate.vramRequiredMB)}</span>
              <span className="composer-mini-dot">·</span>
              <span>{s.candidate.quantization}</span>
              <span className="composer-mini-dot">·</span>
              <span>{s.candidate.family}</span>
            </div>

            {prog && (prog.phase === "pulling" || prog.phase === "queued") ? (
              <PullRow progress={prog} onAbort={() => abort(tag!)} />
            ) : prog?.phase === "error" ? (
              <div className="composer-mini-err" title={prog.error ?? ""}>
                pull failed · {truncate(prog.error ?? "", 40)}
              </div>
            ) : null}

            <div className="composer-mini-actions">
              {renderAction(s, prog, {
                onPull: () => tag && pull(tag),
                onPick: () => tag && onPick(tag),
                onRetry: () => tag && pull(tag),
              })}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function renderAction(
  s: LocalSuggestion,
  prog: PullProgress | undefined,
  handlers: { onPull: () => void; onPick: () => void; onRetry: () => void },
) {
  const tag = s.candidate.ollamaTag;

  if (s.installed && tag) {
    return (
      <button type="button" className="composer-mini-btn is-primary" onClick={handlers.onPick}>
        <Check size={11} /> Switch
      </button>
    );
  }

  if (!tag && s.installCommand) {
    return (
      <button
        type="button"
        className="composer-mini-btn is-ghost"
        onClick={() => navigator.clipboard?.writeText(s.installCommand!)}
        title="Copy launch command"
      >
        Copy command
      </button>
    );
  }

  if (!tag) return null;

  if (prog?.phase === "pulling" || prog?.phase === "queued") {
    return (
      <span className="composer-mini-btn is-ghost is-busy">
        <Loader2 size={11} className="composer-mini-spin" />
        {Math.round(prog.overallPct)}%
      </span>
    );
  }

  if (prog?.phase === "error") {
    return (
      <button type="button" className="composer-mini-btn" onClick={handlers.onRetry}>
        <RotateCw size={11} /> Retry
      </button>
    );
  }

  if (s.fit === "too-big") {
    return (
      <span className="composer-mini-btn is-disabled" title="Exceeds your VRAM budget">
        Beyond this PC
      </span>
    );
  }

  if (s.storage.status === "needs-cleanup") {
    return (
      <span className="composer-mini-btn is-disabled" title={`Free ${s.storage.shortfallGb} GB first`}>
        Free space first
      </span>
    );
  }

  return (
    <button
      type="button"
      className="composer-mini-btn is-primary"
      onClick={handlers.onPull}
      title={`ollama pull ${tag}`}
    >
      <Download size={11} /> Pull
    </button>
  );
}

function PullRow({ progress, onAbort }: { progress: PullProgress; onAbort: () => void }) {
  const pct = Math.round(progress.overallPct);
  const bps = progress.bytesPerSec;
  return (
    <div className="composer-mini-progress">
      <div className="composer-mini-bar">
        <div className="composer-mini-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="composer-mini-progress-meta">
        <span className="composer-mini-status">{progress.statusLine}</span>
        <span className="composer-mini-speed">
          {pct}% {bps > 0 ? `· ${formatRate(bps)}` : ""}
        </span>
        <button
          type="button"
          className="composer-mini-abort"
          onClick={onAbort}
          aria-label="Cancel pull"
        >
          <X size={10} />
        </button>
      </div>
    </div>
  );
}

function FitChip({
  fit,
  installed,
}: {
  fit: LocalSuggestion["fit"];
  installed: boolean;
}) {
  if (installed) return <span className="composer-mini-fit composer-mini-fit--installed">READY</span>;
  const label =
    fit === "perfect" ? "Fits" : fit === "tight" ? "Tight" : fit === "overhead-risk" ? "Risk" : "Beyond";
  return <span className={`composer-mini-fit composer-mini-fit--${fit}`}>{label}</span>;
}

function formatMB(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

function formatRate(bps: number): string {
  if (bps >= 1024 * 1024) return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
  if (bps >= 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${Math.round(bps)} B/s`;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
