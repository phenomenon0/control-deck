"use client";

/**
 * SystemTab — the first tab in the Models pane. Shows the hardware profile
 * and a pill switcher between three cross-modality views:
 *   - Runnable:   local candidates that fit this machine right now
 *   - Local SOTA: best open-weight candidates overall (oversized marked)
 *   - Cloud SOTA: leaderboard-ranked cloud providers per modality
 */

import { useEffect, useMemo, useState } from "react";

import { SystemProfileCard } from "./SystemProfileCard";
import { LocalSuggestionsStrip } from "./LocalSuggestionsStrip";
import { CloudSuggestionsStrip } from "./CloudSuggestionsStrip";
import { MODALITY_LABELS } from "./modality-meta";
import type { SystemProfile } from "@/lib/system/detect";

const LOCAL_CAPABLE_MODALITIES = [
  "text",
  "vision",
  "stt",
  "tts",
  "embedding",
  "image-gen",
] as const;

const CLOUD_MODALITIES = [
  "text",
  "vision",
  "tts",
  "stt",
  "image-gen",
  "audio-gen",
  "embedding",
  "rerank",
  "3d-gen",
  "video-gen",
] as const;

type ViewMode = "runnable" | "local-sota" | "cloud-sota";

const VIEW_LABELS: Record<ViewMode, string> = {
  runnable: "Runnable",
  "local-sota": "Local SOTA",
  "cloud-sota": "Cloud SOTA",
};

const VIEW_DESCRIPTIONS: Record<ViewMode, string> = {
  runnable: "Local models that fit this machine's hardware right now.",
  "local-sota":
    "Best open-weight models overall — includes entries too big for this PC, marked with warnings.",
  "cloud-sota":
    "Leaderboard-ranked cloud providers per modality (no hardware requirement).",
};

interface InstalledModel {
  name: string;
  sizeBytes: number;
  family?: string;
  quantization?: string;
}

export function SystemTab({
  refreshToken,
  showOnlineModels,
}: {
  refreshToken: number;
  showOnlineModels: boolean;
}) {
  const [profile, setProfile] = useState<SystemProfile | null>(null);
  const [installed, setInstalled] = useState<InstalledModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>("runnable");

  useEffect(() => {
    if (!showOnlineModels && view === "cloud-sota") setView("runnable");
  }, [showOnlineModels, view]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/inference/system-profile", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as {
          profile: SystemProfile;
          installed: InstalledModel[];
        };
        if (!alive) return;
        setProfile(data.profile);
        setInstalled(data.installed);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [refreshToken]);

  const modalitiesToRender = useMemo(() => {
    return view === "cloud-sota" ? CLOUD_MODALITIES : LOCAL_CAPABLE_MODALITIES;
  }, [view]);

  const visibleViews = useMemo(
    () =>
      (Object.keys(VIEW_LABELS) as ViewMode[]).filter(
        (v) => showOnlineModels || v !== "cloud-sota",
      ),
    [showOnlineModels],
  );

  if (loading && !profile) {
    return <div className="inference-empty">Probing hardware…</div>;
  }
  if (!profile) return <div className="inference-empty">Unable to read system profile.</div>;

  return (
    <div className="system-tab">
      <SystemProfileCard profile={profile} />

      {installed.length > 0 && (
        <section className="system-installed">
          <div className="label">Installed locally · Ollama</div>
          <div className="system-installed-list">
            {installed.map((m) => (
              <span key={m.name} className="system-installed-chip">
                <span className="inference-mono">{m.name}</span>
                <span className="system-installed-size">
                  {(m.sizeBytes / 1e9).toFixed(1)} GB
                </span>
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="system-suggestions">
        <div className="system-view-switcher">
          <div className="pill-group" role="tablist" aria-label="Suggestion view">
            {visibleViews.map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={`pill${view === v ? " pill--active" : ""}`}
              >
                {VIEW_LABELS[v]}
              </button>
            ))}
          </div>
          <p className="system-view-desc">{VIEW_DESCRIPTIONS[view]}</p>
        </div>

        {modalitiesToRender.map((m) => (
          <div key={`${view}-${m}`} className="system-suggestions-block">
            <h3 className="system-suggestions-title">{MODALITY_LABELS[m]}</h3>
            {view === "cloud-sota" ? (
              <CloudSuggestionsStrip modality={m} limit={3} title="" />
            ) : (
              <LocalSuggestionsStrip
                modality={m}
                limit={view === "local-sota" ? 5 : 3}
                title=""
                refreshToken={refreshToken}
                showAll={view === "local-sota"}
              />
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
