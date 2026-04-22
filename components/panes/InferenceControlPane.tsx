"use client";

/**
 * InferenceControlPane — the first-class Models surface at /deck/models.
 *
 * Top-level shell: a header describing the control plane state, a tabstrip
 * (Overview + one tab per modality), and the active tab's body. Tab choice
 * is URL-synced via `?tab=`. The pane is a peer to Chat / Terminal /
 * Visual / Audio / Control; it reuses the `.control-tabbar` class family
 * and the `.X-stage / .X-head` stage pattern from the deck's other panes.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";

import { OverviewTab } from "./inference/OverviewTab";
import { ModalityTab } from "./inference/ModalityTab";

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

interface TabDef {
  id: "overview" | ModalityId;
  label: string;
}

const TABS: readonly TabDef[] = [
  { id: "overview", label: "Overview" },
  { id: "text", label: "Text" },
  { id: "vision", label: "Vision" },
  { id: "image-gen", label: "Image" },
  { id: "audio-gen", label: "Audio" },
  { id: "tts", label: "TTS" },
  { id: "stt", label: "STT" },
  { id: "embedding", label: "Embed" },
  { id: "rerank", label: "Rerank" },
  { id: "3d-gen", label: "3D" },
  { id: "video-gen", label: "Video" },
];

interface ProvidersResponse {
  modalities: Array<{ id: ModalityId; name: string; description: string; slots: string[] }>;
  providers: Record<string, Array<{ id: string; name: string; requiresApiKey: boolean }>>;
}

interface BindingsResponse {
  persisted: Array<{ modality: string; slotName: string; providerId: string }>;
  effective: Record<string, { providerId: string; config: { model?: string } } | null>;
}

function InferenceControlPaneInner() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const rawTab = params.get("tab");
  const active: TabDef["id"] =
    (TABS.find((t) => t.id === rawTab)?.id as TabDef["id"]) ?? "overview";

  const setTab = useCallback(
    (id: TabDef["id"]) => {
      const sp = new URLSearchParams(params.toString());
      if (id === "overview") {
        sp.delete("tab");
      } else {
        sp.set("tab", id);
      }
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, router, pathname],
  );

  const [summary, setSummary] = useState<{
    totalModalities: number;
    totalProviders: number;
    boundCount: number;
  } | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const refresh = useCallback(() => setRefreshToken((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [provRes, bindRes] = await Promise.all([
          fetch("/api/inference/providers", { cache: "no-store" }),
          fetch("/api/inference/bindings", { cache: "no-store" }),
        ]);
        if (!alive) return;
        if (provRes.ok && bindRes.ok) {
          const prov = (await provRes.json()) as ProvidersResponse;
          const bind = (await bindRes.json()) as BindingsResponse;
          const totalModalities = prov.modalities.length;
          const totalProviders = Object.values(prov.providers).reduce(
            (sum, arr) => sum + arr.length,
            0,
          );
          const boundCount = Object.values(bind.effective).filter((v) => v !== null).length;
          setSummary({ totalModalities, totalProviders, boundCount });
        }
      } catch {
        /* ignore — header just falls back to dashes */
      }
    })();
    return () => {
      alive = false;
    };
  }, [refreshToken]);

  const headerSummary = useMemo(() => {
    if (!summary) return "Loading inference control plane…";
    return `${summary.totalModalities} modalities · ${summary.totalProviders} providers · ${summary.boundCount} bound`;
  }, [summary]);

  return (
    <div className="inference-stage">
      <header className="inference-head">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="label">Control plane</div>
            <h1>Models</h1>
            <p>
              The deck's inference surface. Pick providers per modality, compare them
              against live 2026 benchmarks, and watch them run.
            </p>
          </div>
          <div className="warp-pane-actions">
            <span className="inference-summary">{headerSummary}</span>
            <button
              type="button"
              className="inference-action-btn"
              onClick={refresh}
              title="Refresh"
            >
              Refresh
            </button>
          </div>
        </div>
      </header>

      <div className="control-tabbar">
        {TABS.map((tab) => {
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setTab(tab.id)}
              className={`control-tab${isActive ? " control-tab--active" : ""}`}
              aria-pressed={isActive}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="inference-body">
        {active === "overview" ? (
          <OverviewTab refreshToken={refreshToken} onNavigate={setTab} />
        ) : (
          <ModalityTab modality={active} refreshToken={refreshToken} />
        )}
      </div>
    </div>
  );
}

export function InferenceControlPane() {
  return (
    <Suspense
      fallback={<div className="p-6 text-sm text-[var(--text-muted)]">Loading…</div>}
    >
      <InferenceControlPaneInner />
    </Suspense>
  );
}
