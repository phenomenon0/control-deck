"use client";

/**
 * Unified routing pill. Replaces the prior ComposerModelPicker
 * (Ollama-only) and FreeModeIndicator (free-tier-only) — they were
 * adjacent but independent, which produced silent conflicts. This
 * component is a single source of truth: one active route, one active
 * model, per-mode picks remembered via `DeckSettingsProvider`.
 *
 * Layout:
 *   - Pill shows current mode badge ("Local" / "Free") + active model.
 *   - Click opens a popover with a mode tab at the top and the relevant
 *     catalog below.
 *   - Switching mode swaps in the remembered model for that mode
 *     (see `switchRouteMode` in DeckSettingsProvider).
 *   - Picking a model writes `prefs.model` and, for the local mode,
 *     preloads it into VRAM via /api/hardware/providers/action.
 *
 * Notes:
 *   - The free tab polls /api/free-tier/status every 10s while open or
 *     when freeMode is active, so live quota counters surface immediately.
 *   - Clicking "Hunt" POSTs /api/free-tier/refresh to force-pull the
 *     live OpenRouter catalog.
 *   - If the user has pinned a free model and the router substituted it
 *     because of rate limits, a "preferred: X — substituted" line makes
 *     the hop visible.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Cloud, Cpu, RefreshCw, Sparkles } from "lucide-react";
import { useDeckSettings } from "@/components/settings/DeckSettingsProvider";
import { CLOUD_PROVIDERS } from "@/lib/llm/cloudProviders";
import type { CloudProviderId as CloudId } from "@/lib/llm/cloudProviders";
import { LocalModelPanel } from "@/components/chat/LocalModelPanel";
import { waitForVramResident, listOtherResidentModels } from "@/lib/hardware/ollama-utils";

type Provider = "openrouter" | "nvidia";

interface OllamaTag {
  name: string;
  size: number;
  details?: {
    parameter_size?: string;
    quantization_level?: string;
    family?: string;
  };
}

interface LoadedModel {
  name: string;
  size_vram: number;
}

interface FreeTierModel {
  id: string;
  provider: Provider;
  displayName: string;
  contextWindow: number;
  modality: string;
  rateLimits: { rpm: number; rpd: number };
}

interface StatusEntry {
  model: FreeTierModel;
  remainingRpm: number;
  remainingRpd: number;
  locked: boolean;
  lockReason?: string;
}

interface StatusResponse {
  enabled: boolean;
  providers: { openrouter: boolean; nvidia: boolean };
  activeModelId: string | null;
  catalog: FreeTierModel[];
  status: StatusEntry[];
  lastRefreshAt: number;
  lastRefreshResult: {
    provider: Provider;
    ok: boolean;
    added: number;
    error?: string;
    at: number;
  } | null;
}

function formatContext(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export function RoutePicker() {
  const { prefs, updatePrefs, switchRouteMode } = useDeckSettings();
  const [open, setOpen] = useState(false);
  const [ollamaTags, setOllamaTags] = useState<OllamaTag[]>([]);
  const [ollamaLoaded, setOllamaLoaded] = useState<LoadedModel[]>([]);
  const [ollamaReachable, setOllamaReachable] = useState<boolean>(true);
  const [freeStatus, setFreeStatus] = useState<StatusResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [localView, setLocalView] = useState<"installed" | "discover">("installed");
  const [loadWarning, setLoadWarning] = useState<{
    target: string;
    blockers: { name: string; size_vram?: number }[];
  } | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  const mode = prefs.routeMode;

  const loadOllama = useCallback(async () => {
    const [tagsRes, psRes] = await Promise.all([
      fetch("/api/ollama/tags", { cache: "no-store" }).catch(() => null),
      fetch("/api/ollama/ps", { cache: "no-store" }).catch(() => null),
    ]);
    // 502 / fetch-failed means the daemon isn't listening — distinguish
    // from an ollama that's up but has no pulled models, since the copy
    // and remediation differ ("start ollama" vs "pull a model").
    setOllamaReachable(tagsRes?.ok === true);
    if (tagsRes?.ok) {
      const d = (await tagsRes.json()) as { models: OllamaTag[] };
      setOllamaTags(d.models ?? []);
    } else {
      setOllamaTags([]);
    }
    if (psRes?.ok) {
      const d = (await psRes.json()) as { models: LoadedModel[] };
      setOllamaLoaded(d.models ?? []);
    } else {
      setOllamaLoaded([]);
    }
  }, []);

  const loadFree = useCallback(async () => {
    const r = await fetch("/api/free-tier/status", { cache: "no-store" }).catch(() => null);
    if (r?.ok) setFreeStatus((await r.json()) as StatusResponse);
  }, []);

  const huntFree = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetch("/api/free-tier/refresh", { method: "POST" }).catch(() => null);
      await loadFree();
    } finally {
      setRefreshing(false);
    }
  }, [loadFree]);

  // Background poll while popover is closed but free mode active.
  useEffect(() => {
    if (mode !== "free") return;
    loadFree();
    const iv = setInterval(loadFree, 10_000);
    return () => clearInterval(iv);
  }, [mode, loadFree]);

  // When the Local tab opens, land on whichever view is actionable:
  // discover when no models are installed, installed otherwise.
  useEffect(() => {
    if (!open || mode !== "local") return;
    if (ollamaReachable && ollamaTags.length === 0) setLocalView("discover");
    else if (ollamaTags.length > 0) setLocalView((v) => (v === "discover" ? v : "installed"));
  }, [open, mode, ollamaReachable, ollamaTags.length]);

  // Populate the right catalog when the popover opens.
  useEffect(() => {
    if (!open) return;
    if (mode === "local") loadOllama();
    else loadFree();
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, mode, loadOllama, loadFree]);

  const pickOllama = async (name: string) => {
    updatePrefs({ model: name, localModel: name });
    setBusy(name);
    setLoadWarning(null);
    try {
      await fetch("/api/hardware/providers/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: "ollama", action: "load", model: name }),
      });
      const hot = await waitForVramResident(name, { timeoutMs: 45_000 });
      await loadOllama();
      if (!hot) {
        const others = await listOtherResidentModels(name);
        if (others.length > 0) {
          setLoadWarning({ target: name, blockers: others });
        }
      }
    } finally {
      setBusy(null);
    }
  };

  const unloadBlocker = async (blocker: string) => {
    try {
      await fetch("/api/ollama/ps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: blocker }),
      });
    } finally {
      setLoadWarning(null);
      await loadOllama();
      // Re-trigger the load now that VRAM is free
      if (loadWarning?.target) {
        void pickOllama(loadWarning.target);
      }
    }
  };

  const pickFree = (id: string) => {
    updatePrefs({ model: id, remoteModel: id });
  };

  // Active-model resolution — same tolerant fallback the old pickers used.
  const loadedNames = new Set(ollamaLoaded.map((m) => m.name));
  const ollamaCurrent =
    (mode === "local" && prefs.model) ||
    ollamaLoaded[0]?.name ||
    ollamaTags.find(
      (m) =>
        m.details?.family !== "bert" &&
        m.details?.family !== "nomic-bert" &&
        !m.name.toLowerCase().includes("embed"),
    )?.name ||
    ollamaTags[0]?.name ||
    (mode === "local" && !ollamaReachable ? "ollama down" : "no model");

  const freeActive = freeStatus?.status.find((s) => s.model.id === freeStatus.activeModelId);
  const freePinned = prefs.remoteModel || prefs.model;
  const freeSubstituted =
    mode === "free" &&
    freePinned &&
    freeStatus?.activeModelId &&
    freePinned !== freeStatus.activeModelId;
  const noKey = mode === "free" && freeStatus && !freeStatus.enabled;
  const localDown = mode === "local" && !ollamaReachable;
  const warn = Boolean(noKey) || localDown;

  const cloudProviderRecord = CLOUD_PROVIDERS.find((p) => p.id === prefs.cloudProvider);
  const cloudModelRecord = cloudProviderRecord?.models.find((m) => m.id === prefs.cloudModel);

  const pillIcon =
    mode === "cloud" ? <Cloud size={14} /> : mode === "free" ? <Sparkles size={14} /> : <Cpu size={14} />;
  const pillLabel = mode === "cloud" ? "Cloud" : mode === "free" ? "Free" : "Local";
  const pillModel =
    mode === "local"
      ? ollamaCurrent
      : mode === "free"
        ? freeActive?.model.displayName ?? (freePinned || "pick a model")
        : cloudModelRecord?.displayName ?? prefs.cloudModel ?? "pick a model";

  const byProvider = freeStatus?.status.reduce<Record<Provider, StatusEntry[]>>(
    (acc, s) => {
      (acc[s.model.provider] ||= []).push(s);
      return acc;
    },
    { openrouter: [], nvidia: [] },
  );

  return (
    <div className="composer-route-pill" ref={ref}>
      <button
        type="button"
        className={`composer-tweaks-launch${open ? " is-open" : ""}${warn ? " has-warning" : ""}`}
        onClick={() => setOpen((o) => !o)}
        title={
          noKey
            ? "Free mode active but no provider API key set — chat will fail until one is added"
            : mode === "free"
              ? `Free-tier roulette — active: ${freeActive?.model.id ?? "—"}`
              : mode === "local" && !ollamaReachable
                ? "Ollama daemon not reachable — run `ollama serve`"
                : `Local route — ${ollamaCurrent}${loadedNames.has(ollamaCurrent) ? " (in VRAM)" : ""}`
        }
        aria-expanded={open}
      >
        {warn ? <AlertTriangle size={14} /> : pillIcon}
        <span className="composer-route-mode">{pillLabel}</span>
        <span className="composer-free-sep">·</span>
        <span className="composer-model-name">{pillModel}</span>
        {mode === "local" && loadedNames.has(ollamaCurrent) && (
          <span className="composer-model-hot">HOT</span>
        )}
        {mode === "free" && freeActive && (
          <span className="composer-free-quota">
            {freeActive.remainingRpm}/{freeActive.model.rateLimits.rpm}
          </span>
        )}
      </button>

      {open && (
        <div
          className="composer-tweaks-panel composer-route-panel"
          role="dialog"
          aria-label="Route picker"
        >
          {/* Mode tabs */}
          <div className="composer-route-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "local"}
              className={`composer-route-tab${mode === "local" ? " is-active" : ""}`}
              onClick={() => switchRouteMode("local")}
            >
              <Cpu size={12} /> Local
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "free"}
              className={`composer-route-tab${mode === "free" ? " is-active" : ""}`}
              onClick={() => switchRouteMode("free")}
            >
              <Sparkles size={12} /> Free
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "cloud"}
              className={`composer-route-tab${mode === "cloud" ? " is-active" : ""}`}
              onClick={() => switchRouteMode("cloud")}
            >
              <Cloud size={12} /> Cloud
            </button>
          </div>

          {mode === "local" && (
            <LocalModelPanel
              tags={ollamaTags}
              loaded={ollamaLoaded}
              reachable={ollamaReachable}
              busy={busy}
              activeName={ollamaCurrent}
              view={localView}
              onViewChange={setLocalView}
              onPick={pickOllama}
              onRefresh={loadOllama}
              loadWarning={loadWarning}
              onUnloadBlocker={unloadBlocker}
              onDismissWarning={() => setLoadWarning(null)}
            />
          )}

          {mode === "free" && freeStatus && (
            <>
              <div className="composer-model-head">
                <span className="composer-tweaks-axis-label">Free-tier roulette</span>
                <div className="composer-free-actions">
                  <button
                    type="button"
                    className="composer-free-off"
                    onClick={huntFree}
                    disabled={refreshing}
                    title="Pull the live free-model list from OpenRouter"
                  >
                    <RefreshCw size={10} className={refreshing ? "composer-free-spin" : undefined} />
                    Hunt
                  </button>
                </div>
              </div>

              <div className="composer-free-providers">
                <span className={`composer-free-provider-chip${freeStatus.providers.openrouter ? " is-on" : ""}`}>
                  OpenRouter {freeStatus.providers.openrouter ? "✓" : "· key missing"}
                </span>
                <span className={`composer-free-provider-chip${freeStatus.providers.nvidia ? " is-on" : ""}`}>
                  NVIDIA {freeStatus.providers.nvidia ? "✓" : "· key missing"}
                </span>
              </div>

              {noKey && (
                <p className="composer-free-warning">
                  <AlertTriangle size={12} /> Set <code>OPENROUTER_API_KEY</code> and/or{" "}
                  <code>NVIDIA_API_KEY</code>.
                </p>
              )}
              {!noKey && (
                <p className="composer-free-note">
                  Prompts may be used for training. Don&apos;t route sensitive threads here.
                  {freeStatus.lastRefreshResult?.ok === false && (
                    <span className="composer-free-stale">
                      {" "}· last refresh failed: {freeStatus.lastRefreshResult.error}
                    </span>
                  )}
                </p>
              )}
              {freeSubstituted && (
                <p className="composer-free-note">
                  <span className="composer-free-stale">preferred: {freePinned}</span>{" "}
                  — currently substituted (rate-limited or unavailable).
                </p>
              )}

              {(["openrouter", "nvidia"] as const).map((provider) => {
                const entries = byProvider?.[provider] ?? [];
                if (entries.length === 0) return null;
                return (
                  <div key={provider} className="composer-free-provider-group">
                    <div className="composer-free-provider-head">
                      {provider === "openrouter" ? "OpenRouter" : "NVIDIA NIM"} · {entries.length}
                    </div>
                    <ul className="composer-model-list">
                      {entries.map(({ model, remainingRpm, remainingRpd, locked, lockReason }) => {
                        const isActive = model.id === freeStatus.activeModelId;
                        const isPinned = model.id === freePinned;
                        return (
                          <li key={model.id}>
                            <button
                              type="button"
                              className={`composer-model-row${isActive ? " is-active" : ""}${locked ? " is-locked" : ""}`}
                              onClick={() => pickFree(model.id)}
                            >
                              <div className="composer-model-row-main">
                                <span className="composer-model-row-name">{model.displayName}</span>
                                {isActive && <span className="composer-model-hot">ACTIVE</span>}
                                {isPinned && !isActive && (
                                  <span className="composer-model-hot">PINNED</span>
                                )}
                                {locked && (
                                  <span className="composer-free-locked">{lockReason}</span>
                                )}
                              </div>
                              <div className="composer-model-row-meta">
                                {formatContext(model.contextWindow)} ctx · {model.modality} ·{" "}
                                {remainingRpm}/{model.rateLimits.rpm} rpm ·{" "}
                                {remainingRpd}/{model.rateLimits.rpd} rpd
                              </div>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </>
          )}

          {mode === "cloud" && (
            <>
              <div className="composer-model-head">
                <span className="composer-tweaks-axis-label">Cloud providers</span>
              </div>
              <div className="composer-free-providers">
                {CLOUD_PROVIDERS.map((p) => {
                  const isActive = p.id === prefs.cloudProvider;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`composer-free-provider-chip${isActive ? " is-on" : ""}`}
                      disabled={!p.implemented}
                      onClick={() => {
                        const firstModel = p.models[0]?.id ?? "";
                        updatePrefs({ cloudProvider: p.id as CloudId, cloudModel: firstModel });
                      }}
                      title={p.implemented ? `Use ${p.name}` : `${p.name} adapter not yet implemented`}
                    >
                      {p.name}
                      {!p.implemented && " · soon"}
                    </button>
                  );
                })}
              </div>
              <p className="composer-free-note">
                Paid providers — charged per token. API key via <code>{cloudProviderRecord?.envKey ?? "..."}</code>.
              </p>
              {cloudProviderRecord && (
                <ul className="composer-model-list">
                  {cloudProviderRecord.models.map((m) => {
                    const isActive = m.id === prefs.cloudModel;
                    return (
                      <li key={m.id}>
                        <button
                          type="button"
                          className={`composer-model-row${isActive ? " is-active" : ""}`}
                          onClick={() => updatePrefs({ cloudModel: m.id })}
                        >
                          <div className="composer-model-row-main">
                            <span className="composer-model-row-name">{m.displayName}</span>
                            {isActive && <span className="composer-model-hot">ACTIVE</span>}
                          </div>
                          <div className="composer-model-row-meta">
                            {formatContext(m.contextWindow)} ctx · {m.modality}
                            {m.note && ` · ${m.note}`}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
