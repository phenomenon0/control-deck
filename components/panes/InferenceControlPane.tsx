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

import { OverviewTab } from "./inference/OverviewTab";
import { ModalityTab } from "./inference/ModalityTab";
import { SystemTab } from "./inference/SystemTab";
import { useDeckSettings } from "@/components/settings/DeckSettingsProvider";
import { useUrlTab } from "@/lib/hooks/useUrlTab";

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
  id: "system" | "overview" | ModalityId;
  label: string;
}

const TABS: readonly TabDef[] = [
  { id: "system", label: "System" },
  { id: "overview", label: "Overview" },
  { id: "text", label: "Text" },
  { id: "vision", label: "Vision" },
  { id: "image-gen", label: "Image" },
  { id: "audio-gen", label: "Music/SFX" },
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
  const { active, setTab } = useUrlTab(TABS, "system");
  const { prefs, updatePrefs, switchRouteMode } = useDeckSettings();
  const showOnlineModels = prefs.showOnlineModels;

  const [summary, setSummary] = useState<{
    totalModalities: number;
    totalProviders: number;
    boundSlots: number;
  } | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const refresh = useCallback(() => setRefreshToken((n) => n + 1), []);
  const toggleOnlineModels = useCallback(() => {
    const next = !showOnlineModels;
    updatePrefs({ showOnlineModels: next });
    if (!next && prefs.routeMode !== "local") switchRouteMode("local");
  }, [showOnlineModels, updatePrefs, prefs.routeMode, switchRouteMode]);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    (async () => {
      try {
        setSummaryError(null);
        const [provRes, bindRes] = await Promise.all([
          fetch("/api/inference/providers", {
            cache: "no-store",
            signal: controller.signal,
          }),
          fetch("/api/inference/bindings", {
            cache: "no-store",
            signal: controller.signal,
          }),
        ]);
        if (!alive) return;
        const [provData, bindData] = await Promise.all([
          provRes.json().catch(() => null),
          bindRes.json().catch(() => null),
        ]);

        if (!provRes.ok) {
          throw new Error(extractApiError(provData, `Providers ${provRes.status}`));
        }
        if (!bindRes.ok) {
          throw new Error(extractApiError(bindData, `Bindings ${bindRes.status}`));
        }

        const prov = provData as ProvidersResponse;
        const bind = bindData as BindingsResponse;
        const totalModalities = prov.modalities.length;
        const totalProviders = new Set(
          Object.values(prov.providers)
            .flat()
            .filter((provider) => showOnlineModels || !provider.requiresApiKey)
            .map((provider) => provider.id),
        ).size;
        const boundSlots = Object.values(bind.effective).filter((v) => v !== null).length;
        setSummary({ totalModalities, totalProviders, boundSlots });
      } catch (error) {
        if (!alive || controller.signal.aborted) return;
        setSummaryError(error instanceof Error ? error.message : "Summary unavailable");
      }
    })();
    return () => {
      alive = false;
      controller.abort();
    };
  }, [refreshToken, showOnlineModels]);

  const headerSummary = useMemo(() => {
    if (summaryError) return `Summary unavailable: ${summaryError}`;
    if (!summary) return "Loading inference control plane…";
    const providerLabel = showOnlineModels ? "providers" : "local providers";
    return `${summary.totalModalities} modalities · ${summary.totalProviders} ${providerLabel} · ${summary.boundSlots} bound slots`;
  }, [summary, summaryError, showOnlineModels]);

  return (
    <div className="inference-stage">
      <header className="inference-head">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="label">Control plane</div>
            <h1>Models</h1>
            <p>
              The deck&apos;s inference surface. Pick providers per modality, compare
              current benchmark metadata, and watch them run.
            </p>
          </div>
          <div className="warp-pane-actions">
            <span className="inference-summary">{headerSummary}</span>
            <button
              type="button"
              className="inference-action-btn inference-action-btn--ghost"
              onClick={toggleOnlineModels}
              title={showOnlineModels ? "Hide free and cloud models" : "Show free and cloud models"}
            >
              {showOnlineModels ? "Hide online" : "Show online"}
            </button>
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

      <div className="control-tabbar" role="tablist" aria-label="Model sections">
        {TABS.map((tab) => {
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              id={`inference-tab-${tab.id}`}
              role="tab"
              aria-controls={`inference-panel-${tab.id}`}
              aria-selected={isActive}
              onClick={() => setTab(tab.id)}
              className={`control-tab${isActive ? " control-tab--active" : ""}`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div
        id={`inference-panel-${active}`}
        role="tabpanel"
        aria-labelledby={`inference-tab-${active}`}
        className="inference-body"
      >
        {active === "system" ? (
          <SystemTab refreshToken={refreshToken} showOnlineModels={showOnlineModels} />
        ) : active === "overview" ? (
          <OverviewTab
            refreshToken={refreshToken}
            onNavigate={setTab}
            showOnlineModels={showOnlineModels}
          />
        ) : (
          <ModalityTab
            modality={active}
            refreshToken={refreshToken}
            showOnlineModels={showOnlineModels}
          />
        )}
      </div>
    </div>
  );
}

function extractApiError(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "error" in data) {
    const value = (data as { error?: unknown }).error;
    if (typeof value === "string" && value.trim()) return value;
  }
  return fallback;
}

export function InferenceControlPane() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-[var(--text-muted)]">Loading…</div>}>
      <InferenceControlPaneInner />
    </Suspense>
  );
}
