"use client";

/**
 * SystemTab — the first tab in the Models pane. Shows the hardware profile
 * and renders a LocalSuggestionsStrip for every modality that has a local
 * path, so users get a single-screen overview of what their PC can actually
 * run across the whole control plane.
 */

import { useEffect, useState } from "react";

import { SystemProfileCard } from "./SystemProfileCard";
import { LocalSuggestionsStrip } from "./LocalSuggestionsStrip";
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

interface InstalledModel {
  name: string;
  sizeBytes: number;
  family?: string;
  quantization?: string;
}

export function SystemTab({ refreshToken }: { refreshToken: number }) {
  const [profile, setProfile] = useState<SystemProfile | null>(null);
  const [installed, setInstalled] = useState<InstalledModel[]>([]);
  const [loading, setLoading] = useState(true);

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
        <div className="label">Recommended for your hardware · per modality</div>
        {LOCAL_CAPABLE_MODALITIES.map((m) => (
          <div key={m} className="system-suggestions-block">
            <h3 className="system-suggestions-title">{MODALITY_LABELS[m]}</h3>
            <LocalSuggestionsStrip
              modality={m}
              limit={3}
              title=""
              refreshToken={refreshToken}
            />
          </div>
        ))}
      </section>
    </div>
  );
}
