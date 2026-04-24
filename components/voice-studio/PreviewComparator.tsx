"use client";

import { useMemo, useState } from "react";

interface HydratedPreview {
  id: string;
  promptText: string;
  ratingSimilarity: number | null;
  ratingQuality: number | null;
  ratingLatency: number | null;
  artifact: {
    id: string;
    name: string;
    mimeType: string;
    url: string;
    createdAt: string;
  } | null;
}

interface PreviewComparatorProps {
  previews: HydratedPreview[];
  /** Called after a rating write succeeds so the parent can refresh detail. */
  onRated?: () => Promise<void> | void;
}

type Axis = "similarity" | "quality";

export function PreviewComparator({ previews, onRated }: PreviewComparatorProps) {
  const [mode, setMode] = useState<"grid" | "ab">("grid");
  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="label">Preview bank</div>
          <h3 className="text-sm font-medium text-[var(--text-primary)]">Generated previews</h3>
        </div>
        <div className="flex gap-2" role="tablist" aria-label="Comparator mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "grid"}
            className={`control-tab${mode === "grid" ? " control-tab--active" : ""}`}
            onClick={() => setMode("grid")}
          >
            Grid
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "ab"}
            className={`control-tab${mode === "ab" ? " control-tab--active" : ""}`}
            onClick={() => setMode("ab")}
            disabled={previews.length < 2}
            title={previews.length < 2 ? "Need 2+ previews for blind A/B" : undefined}
          >
            Blind A/B
          </button>
        </div>
      </div>

      {previews.length === 0 ? (
        <div className="text-sm text-[var(--text-muted)]">No previews yet.</div>
      ) : mode === "grid" ? (
        <PreviewGrid previews={previews} onRated={onRated} />
      ) : (
        <BlindAB previews={previews} onRated={onRated} />
      )}
    </div>
  );
}

function PreviewGrid({
  previews,
  onRated,
}: {
  previews: HydratedPreview[];
  onRated?: () => Promise<void> | void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {previews.map((preview) => (
        <PreviewCard key={preview.id} preview={preview} onRated={onRated} />
      ))}
    </div>
  );
}

function PreviewCard({
  preview,
  onRated,
}: {
  preview: HydratedPreview;
  onRated?: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState<Axis | null>(null);
  const [local, setLocal] = useState({
    similarity: preview.ratingSimilarity,
    quality: preview.ratingQuality,
  });

  async function rate(axis: Axis, value: number) {
    setBusy(axis);
    try {
      const res = await fetch(`/api/voice/previews/${preview.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [axis]: value }),
      });
      if (res.ok) {
        setLocal((prev) => ({ ...prev, [axis]: value }));
        if (onRated) await onRated();
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card-sub space-y-3">
      <div className="text-sm text-[var(--text-primary)] line-clamp-3">{preview.promptText}</div>
      {preview.artifact ? (
        <audio controls className="w-full" src={preview.artifact.url} preload="none" />
      ) : (
        <div className="text-xs text-[var(--text-muted)]">Artifact unavailable</div>
      )}
      <RatingRow
        label="Similarity"
        value={local.similarity}
        busy={busy === "similarity"}
        onChange={(v) => rate("similarity", v)}
      />
      <RatingRow
        label="Quality"
        value={local.quality}
        busy={busy === "quality"}
        onChange={(v) => rate("quality", v)}
      />
      {preview.ratingLatency != null ? (
        <div className="text-xs text-[var(--text-muted)]">latency {Math.round(preview.ratingLatency)}ms</div>
      ) : null}
    </div>
  );
}

function RatingRow({
  label,
  value,
  busy,
  onChange,
}: {
  label: string;
  value: number | null;
  busy: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-20 text-[var(--text-muted)]">{label}</span>
      {[1, 2, 3, 4, 5].map((n) => {
        const active = value != null && n <= value;
        return (
          <button
            key={n}
            type="button"
            disabled={busy}
            onClick={() => onChange(n)}
            className={`h-6 w-6 rounded border text-xs ${
              active
                ? "border-[var(--accent)] bg-[var(--accent)]/20 text-[var(--text-primary)]"
                : "border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)]"
            }`}
            aria-label={`${label} ${n}`}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

function BlindAB({
  previews,
  onRated,
}: {
  previews: HydratedPreview[];
  onRated?: () => Promise<void> | void;
}) {
  const pair = useMemo(() => {
    // Shuffle a fresh pair per session so the listener doesn't anchor.
    const shuffled = [...previews].sort(() => Math.random() - 0.5).slice(0, 2);
    return shuffled as [HydratedPreview, HydratedPreview];
  }, [previews]);
  const [revealed, setRevealed] = useState(false);
  const [winner, setWinner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function pick(preview: HydratedPreview) {
    setWinner(preview.id);
    setBusy(true);
    try {
      // The "win" bumps the similarity rating by +1 (capped at 5). Not perfect
      // but gives a cheap preference signal without a separate column.
      const nextRating = Math.min(5, (preview.ratingSimilarity ?? 3) + 1);
      await fetch(`/api/voice/previews/${preview.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ similarity: nextRating }),
      });
      if (onRated) await onRated();
    } finally {
      setBusy(false);
      setRevealed(true);
    }
  }

  return (
    <div className="space-y-4">
      <div className="text-xs text-[var(--text-muted)]">
        Listen to both takes, pick the one you prefer. Engine labels stay hidden until you commit.
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {pair.map((preview, index) => (
          <div key={preview.id} className="card-sub space-y-3">
            <div className="text-sm font-medium text-[var(--text-primary)]">
              Take {index === 0 ? "A" : "B"}
              {revealed ? (
                <span className="ml-2 text-xs text-[var(--text-muted)]">
                  ({preview.artifact?.name ?? "unknown"})
                </span>
              ) : null}
            </div>
            <div className="text-xs text-[var(--text-muted)] line-clamp-2">{preview.promptText}</div>
            {preview.artifact ? (
              <audio controls className="w-full" src={preview.artifact.url} preload="none" />
            ) : null}
            <button
              type="button"
              className={`btn ${winner === preview.id ? "btn-primary" : "btn-secondary"} w-full`}
              onClick={() => pick(preview)}
              disabled={busy || revealed}
            >
              {winner === preview.id ? "Picked" : `Prefer ${index === 0 ? "A" : "B"}`}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
