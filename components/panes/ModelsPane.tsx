"use client";

/**
 * Models pane — browse + configure every model surface available to the
 * chat runtime, grouped by routing mode (Local / Free / Cloud). Each
 * model card carries a "Set as default" action that calls
 * `switchRouteMode` + `updatePrefs` so the RoutePicker pill reflects
 * the choice immediately.
 *
 * Previously the pane was Ollama-only library management. Pull/delete
 * lives under the Local tab; Free and Cloud show the catalog rendered
 * by the router / provider registry.
 */

import { useState, useEffect, useMemo, useCallback, type ReactNode } from "react";
import { Gauge, Check, Sparkles, Cloud, Cpu, AlertTriangle, Search } from "lucide-react";
import { VramEstimator } from "@/components/models/VramEstimator";
import { LocalModelsPanel } from "@/components/models/LocalModelsPanel";
import { useDeckSettings, type RouteMode, type CloudProviderId } from "@/components/settings/DeckSettingsProvider";
import { CLOUD_PROVIDERS } from "@/lib/llm/cloudProviders";
import { useCatalog, type CatalogModel } from "@/lib/hooks/useCatalog";

interface OllamaModel {
  name: string;
  model: string;
  modified_at: string;
  size: number;
  digest: string;
  details: {
    parent_model: string;
    format: string;
    family: string;
    families: string[];
    parameter_size: string;
    quantization_level: string;
  };
}

interface FreeTierModel {
  id: string;
  provider: "openrouter" | "nvidia";
  displayName: string;
  contextWindow: number;
  modality: string;
  rateLimits: { rpm: number; rpd: number };
}

interface FreeStatusEntry {
  model: FreeTierModel;
  remainingRpm: number;
  remainingRpd: number;
  locked: boolean;
  lockReason?: string;
}

interface FreeStatus {
  enabled: boolean;
  providers: { openrouter: boolean; nvidia: boolean };
  activeModelId: string | null;
  catalog: FreeTierModel[];
  status: FreeStatusEntry[];
}

type TabId = "local" | "free" | "cloud";
type ModeTab = { id: TabId; label: string; icon: ReactNode };

export function ModelsPane() {
  const { prefs, updatePrefs, switchRouteMode } = useDeckSettings();
  const showOnlineModels = prefs.showOnlineModels;
  const [tab, setTab] = useState<TabId>(
    showOnlineModels
      ? prefs.routeMode === "free"
        ? "free"
        : prefs.routeMode === "cloud"
          ? "cloud"
          : "local"
      : "local",
  );

  // --- Local/Ollama state (was the whole pane before) ---
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [pulling, setPulling] = useState<string | null>(null);
  const [newModel, setNewModel] = useState("");
  const [vramTarget, setVramTarget] = useState<OllamaModel | null>(null);

  const fetchOllama = useCallback(async () => {
    try {
      const res = await fetch("/api/ollama/tags");
      const data = await res.json();
      setModels(data.models ?? []);
    } catch (err) {
      console.warn("[ModelsPane] Ollama fetch failed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOllama();
  }, [fetchOllama]);

  useEffect(() => {
    if (!showOnlineModels && tab !== "local") setTab("local");
  }, [showOnlineModels, tab]);

  // --- Free-tier state ---
  const [freeStatus, setFreeStatus] = useState<FreeStatus | null>(null);
  const [refreshingFree, setRefreshingFree] = useState(false);

  const fetchFree = useCallback(async () => {
    const r = await fetch("/api/free-tier/status", { cache: "no-store" }).catch(() => null);
    if (r?.ok) setFreeStatus((await r.json()) as FreeStatus);
  }, []);

  useEffect(() => {
    if (showOnlineModels && tab === "free") fetchFree();
  }, [showOnlineModels, tab, fetchFree]);

  const huntFree = useCallback(async () => {
    setRefreshingFree(true);
    try {
      await fetch("/api/free-tier/refresh", { method: "POST" }).catch(() => null);
      await fetchFree();
    } finally {
      setRefreshingFree(false);
    }
  }, [fetchFree]);

  // --- Actions ---
  const handlePull = async () => {
    if (!newModel.trim()) return;
    setPulling(newModel);
    try {
      await fetch("/api/ollama/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newModel }),
      });
      await fetchOllama();
      setNewModel("");
    } catch {
      alert("Failed to pull model");
    } finally {
      setPulling(null);
    }
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`Delete model "${name}"?`)) return;
    try {
      await fetch("/api/ollama/tags", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      await fetchOllama();
    } catch {
      alert("Failed to delete model");
    }
  };

  /**
   * Make this the default model for chat. Flips routeMode to match the
   * model's origin and writes the right slot. User's other-mode picks
   * are preserved.
   */
  const setDefault = (args: { mode: RouteMode; modelId: string; cloudProvider?: CloudProviderId }) => {
    if (args.mode === "local") {
      updatePrefs({ model: args.modelId, localModel: args.modelId });
    } else if (args.mode === "free") {
      updatePrefs({ model: args.modelId, remoteModel: args.modelId });
    } else if (args.mode === "cloud" && args.cloudProvider) {
      updatePrefs({ cloudProvider: args.cloudProvider, cloudModel: args.modelId });
    }
    if (prefs.routeMode !== args.mode) switchRouteMode(args.mode);
  };

  const isCurrentDefault = (mode: RouteMode, modelId: string, cloudProvider?: CloudProviderId) => {
    if (prefs.routeMode !== mode) return false;
    if (mode === "local") return prefs.model === modelId;
    if (mode === "free") return prefs.model === modelId;
    if (mode === "cloud") return prefs.cloudProvider === cloudProvider && prefs.cloudModel === modelId;
    return false;
  };

  const formatSize = (bytes: number) => {
    const gb = bytes / 1024 / 1024 / 1024;
    if (gb >= 1) return `${gb.toFixed(1)} GB`;
    const mb = bytes / 1024 / 1024;
    return `${mb.toFixed(0)} MB`;
  };

  const formatContext = (n: number): string => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return String(n);
  };

  const tabCounts = useMemo(
    () => ({
      local: models.length,
      free: showOnlineModels ? freeStatus?.catalog.length ?? 0 : 0,
      cloud: showOnlineModels ? CLOUD_PROVIDERS.reduce((sum, p) => sum + p.models.length, 0) : 0,
    }),
    [models.length, freeStatus?.catalog.length, showOnlineModels],
  );

  // --- Catalog browse state ---
  const [catalogQ, setCatalogQ] = useState("");
  const freeCatalog = useCatalog({
    provider: "openrouter",
    free: true,
    limit: 120,
    q: catalogQ || undefined,
    enabled: showOnlineModels && tab === "free",
  });
  const nvidiaCatalog = useCatalog({
    provider: "nvidia",
    limit: 250,
    q: catalogQ || undefined,
    enabled: showOnlineModels && tab === "free",
  });
  const modeTabs = useMemo<ModeTab[]>(() => {
    const tabs: ModeTab[] = [{ id: "local", label: "Local", icon: <Cpu size={14} /> }];
    if (showOnlineModels) {
      tabs.push(
        { id: "free", label: "Free tier", icon: <Sparkles size={14} /> },
        { id: "cloud", label: "Cloud", icon: <Cloud size={14} /> },
      );
    }
    return tabs;
  }, [showOnlineModels]);

  return (
    <div className="models-stage">
      <header className="models-head">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="label">Model catalog</div>
            <h1>Models</h1>
            <p>
              Every route mode&apos;s catalog in one place. Click &quot;Set as default&quot; on any card to make it
              the active model for chat.
            </p>
          </div>
          <div className="warp-pane-actions">
            <span className="pill--mono">
              active: {prefs.routeMode === "cloud" ? prefs.cloudModel : prefs.model || "—"}
            </span>
            <button
              type="button"
              className="btn btn-secondary text-xs"
              onClick={() => updatePrefs({ showOnlineModels: !showOnlineModels })}
              title={showOnlineModels ? "Hide free and cloud models" : "Show free and cloud models"}
            >
              {showOnlineModels ? "Hide online" : "Show online"}
            </button>
          </div>
        </div>
      </header>

      <LocalModelsPanel
        preset={prefs.localModelPreset}
        onPresetChange={(p) => updatePrefs({ localModelPreset: p })}
      />

      {/* Mode tabs */}
      <div className="flex gap-2 mb-5">
        {modeTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`btn ${tab === t.id ? "btn-primary" : "btn-secondary"} text-xs`}
          >
            <span className="inline-flex items-center gap-1.5">
              {t.icon} {t.label}
              <span className="opacity-60 ml-1">{tabCounts[t.id]}</span>
            </span>
          </button>
        ))}
      </div>

      {/* LOCAL TAB */}
      {tab === "local" && (
        <>
          <div className="warp-pane-card p-4 mb-6">
            <div className="flex gap-2">
              <input
                type="text"
                value={newModel}
                onChange={(e) => setNewModel(e.target.value)}
                placeholder="Pull a model (e.g. llama3.2:3b)"
                className="flex-1 h-9 px-3 rounded-[6px] bg-[rgba(255,255,255,0.04)] border border-[var(--border)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)] transition-colors duration-150 ease-[cubic-bezier(0,0,0.2,1)]"
                onKeyDown={(e) => e.key === "Enter" && handlePull()}
              />
              <button onClick={handlePull} disabled={!!pulling || !newModel.trim()} className="btn btn-primary">
                {pulling ? "Pulling..." : "Pull"}
              </button>
              <button onClick={fetchOllama} className="btn btn-secondary text-xs">
                Refresh
              </button>
            </div>
            {pulling && (
              <div className="mt-3">
                <div className="h-1 w-full rounded-full bg-[rgba(255,255,255,0.06)] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[var(--accent)] animate-pulse"
                    style={{ width: "60%" }}
                  />
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-1">Pulling {pulling}...</p>
              </div>
            )}
          </div>

          <div>
            {loading ? (
              <div className="p-12 text-center text-[var(--text-muted)]">Loading...</div>
            ) : models.length === 0 ? (
              <div className="p-16 text-center">
                <div className="text-5xl mb-4 opacity-30">&#9881;</div>
                <p className="text-base font-medium text-[var(--text-secondary)] mb-2">No models installed</p>
                <p className="text-sm text-[var(--text-muted)] mb-6">Pull a model to get started</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {models.map((model) => {
                  const isDefault = isCurrentDefault("local", model.name);
                  return (
                    <div
                      key={model.name}
                      className={`rounded-[6px] border ${isDefault ? "border-[var(--accent)]" : "border-[var(--border)]"} bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.04)] transition-colors p-4`}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-[var(--text-primary)] truncate flex items-center gap-2">
                            {model.name}
                            {isDefault && <Check size={12} className="text-[var(--accent)]" />}
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="badge badge-info text-[10px]">{model.details?.family ?? "unknown"}</span>
                            <span className="text-xs text-[var(--text-muted)]">{model.details?.parameter_size ?? "?"}</span>
                          </div>
                        </div>
                        <span
                          className="inline-block w-[6px] h-[6px] rounded-full bg-[var(--success)] ml-2 mt-1 flex-shrink-0"
                          title="Available"
                        />
                      </div>

                      <div className="flex items-center gap-3 text-xs text-[var(--text-muted)] mb-3">
                        <span className="font-mono">{formatSize(model.size)}</span>
                        {model.details?.quantization_level && (
                          <span className="badge badge-neutral text-[10px]">{model.details.quantization_level}</span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-[var(--border)]">
                        <button
                          onClick={() => setDefault({ mode: "local", modelId: model.name })}
                          className={`btn text-xs ${isDefault ? "btn-ghost opacity-60 cursor-default" : "btn-primary"}`}
                          disabled={isDefault}
                        >
                          {isDefault ? "Default" : "Set default"}
                        </button>
                        <button onClick={() => setVramTarget(model)} className="btn btn-ghost text-xs" title="Estimate VRAM">
                          <Gauge className="w-3.5 h-3.5 mr-1 inline" />
                          VRAM
                        </button>
                        <button
                          onClick={() => navigator.clipboard.writeText(model.name)}
                          className="btn btn-ghost text-xs"
                          title="Copy name"
                        >
                          Copy
                        </button>
                        <button
                          onClick={() => handleDelete(model.name)}
                          className="btn btn-ghost text-xs text-[var(--error)]"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* FREE TAB */}
      {showOnlineModels && tab === "free" && (
        <>
          <div className="flex items-center gap-3 mb-5">
            <span className="text-xs text-[var(--text-muted)]">
              OpenRouter {freeStatus?.providers.openrouter ? "✓" : "· key missing"}
            </span>
            <span className="text-xs text-[var(--text-muted)]">
              NVIDIA {freeStatus?.providers.nvidia ? "✓" : "· key missing"}
            </span>
            <button onClick={huntFree} disabled={refreshingFree} className="btn btn-secondary text-xs ml-auto">
              {refreshingFree ? "Hunting..." : "Hunt new models"}
            </button>
          </div>

          {!freeStatus ? (
            <div className="p-12 text-center text-[var(--text-muted)]">Loading free-tier catalog...</div>
          ) : freeStatus.catalog.length === 0 ? (
            <div className="p-16 text-center text-[var(--text-muted)]">No free models available right now.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {freeStatus.status.map(({ model, remainingRpm, remainingRpd, locked, lockReason }) => {
                const isDefault = isCurrentDefault("free", model.id);
                const isActive = model.id === freeStatus.activeModelId;
                return (
                  <div
                    key={model.id}
                    className={`rounded-[6px] border ${isDefault ? "border-[var(--accent)]" : "border-[var(--border)]"} bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.04)] transition-colors p-4 ${locked ? "opacity-60" : ""}`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-[var(--text-primary)] truncate flex items-center gap-2">
                          {model.displayName}
                          {isDefault && <Check size={12} className="text-[var(--accent)]" />}
                        </div>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span className="badge badge-info text-[10px]">{model.provider}</span>
                          <span className="text-xs text-[var(--text-muted)]">{formatContext(model.contextWindow)} ctx</span>
                          <span className="text-xs text-[var(--text-muted)]">· {model.modality}</span>
                          {isActive && <span className="badge text-[10px]">ACTIVE</span>}
                        </div>
                      </div>
                    </div>
                    <div className="text-xs text-[var(--text-muted)] mb-3 font-mono">
                      {remainingRpm}/{model.rateLimits.rpm} rpm · {remainingRpd}/{model.rateLimits.rpd} rpd
                      {locked && (
                        <span className="ml-2 badge badge-neutral text-[10px]">
                          <AlertTriangle size={10} className="inline mr-1" />
                          {lockReason}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 pt-3 border-t border-[var(--border)]">
                      <button
                        onClick={() => setDefault({ mode: "free", modelId: model.id })}
                        className={`btn text-xs ${isDefault ? "btn-ghost opacity-60 cursor-default" : "btn-primary"}`}
                        disabled={isDefault}
                      >
                        {isDefault ? "Default" : "Set default"}
                      </button>
                      <button
                        onClick={() => navigator.clipboard.writeText(model.id)}
                        className="btn btn-ghost text-xs"
                        title="Copy model id"
                      >
                        Copy id
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <CatalogBrowse
            title="Full OpenRouter catalog"
            subtitle={`${freeCatalog.total} free-tagged models`}
            result={freeCatalog}
            q={catalogQ}
            onQChange={setCatalogQ}
            isDefault={(id) => isCurrentDefault("free", id)}
            onSetDefault={(id) => setDefault({ mode: "free", modelId: id })}
            formatContext={formatContext}
          />

          <CatalogBrowse
            title="NVIDIA NIM catalog"
            subtitle={`${nvidiaCatalog.total} models`}
            result={nvidiaCatalog}
            q={catalogQ}
            onQChange={setCatalogQ}
            isDefault={(id) => isCurrentDefault("free", id)}
            onSetDefault={(id) => setDefault({ mode: "free", modelId: id })}
            formatContext={formatContext}
          />
        </>
      )}

      {/* CLOUD TAB */}
      {showOnlineModels && tab === "cloud" && (
        <div className="flex flex-col gap-6">
          {CLOUD_PROVIDERS.map((provider) => (
            <section key={provider.id}>
              <div className="flex items-center gap-3 mb-3">
                <h2 className="text-base font-semibold text-[var(--text-primary)]">{provider.name}</h2>
                {!provider.implemented && (
                  <span className="badge badge-neutral text-[10px]">adapter not wired</span>
                )}
                <span className="text-xs text-[var(--text-muted)] ml-auto font-mono">
                  env: {provider.envKey}
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {provider.models.map((m) => {
                  const isDefault = isCurrentDefault("cloud", m.id, provider.id);
                  return (
                    <div
                      key={m.id}
                      className={`rounded-[6px] border ${isDefault ? "border-[var(--accent)]" : "border-[var(--border)]"} bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.04)] transition-colors p-4 ${!provider.implemented ? "opacity-60" : ""}`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-[var(--text-primary)] truncate flex items-center gap-2">
                            {m.displayName}
                            {isDefault && <Check size={12} className="text-[var(--accent)]" />}
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="badge badge-info text-[10px]">{m.modality}</span>
                            <span className="text-xs text-[var(--text-muted)]">{formatContext(m.contextWindow)} ctx</span>
                          </div>
                        </div>
                      </div>
                      {m.note && (
                        <p className="text-xs text-[var(--text-muted)] mb-3 italic">{m.note}</p>
                      )}
                      <div className="flex items-center gap-2 pt-3 border-t border-[var(--border)]">
                        <button
                          onClick={() => setDefault({ mode: "cloud", modelId: m.id, cloudProvider: provider.id })}
                          className={`btn text-xs ${isDefault ? "btn-ghost opacity-60 cursor-default" : "btn-primary"}`}
                          disabled={isDefault || !provider.implemented}
                        >
                          {isDefault ? "Default" : "Set default"}
                        </button>
                        <button
                          onClick={() => navigator.clipboard.writeText(m.id)}
                          className="btn btn-ghost text-xs"
                          title="Copy model id"
                        >
                          Copy id
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {vramTarget && (
        <VramEstimator
          modelName={vramTarget.name}
          modelBytes={vramTarget.size}
          onClose={() => setVramTarget(null)}
        />
      )}
    </div>
  );
}

interface CatalogBrowseProps {
  title: string;
  subtitle: string;
  result: ReturnType<typeof useCatalog>;
  q: string;
  onQChange: (q: string) => void;
  isDefault: (id: string) => boolean;
  onSetDefault: (id: string) => void;
  formatContext: (n: number) => string;
}

function CatalogBrowse({
  title,
  subtitle,
  result,
  q,
  onQChange,
  isDefault,
  onSetDefault,
  formatContext,
}: CatalogBrowseProps) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? result.models : result.models.slice(0, 12);

  return (
    <section className="mt-8">
      <div className="flex items-center gap-3 mb-3">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
        <span className="text-xs text-[var(--text-muted)]">{subtitle}</span>
        <div className="ml-auto relative">
          <Search
            size={12}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
          />
          <input
            type="text"
            value={q}
            onChange={(e) => onQChange(e.target.value)}
            placeholder="Search catalog"
            className="h-7 pl-7 pr-2 text-xs rounded-[6px] bg-[rgba(255,255,255,0.04)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)] w-48"
          />
        </div>
      </div>

      {result.loading && result.models.length === 0 ? (
        <div className="text-xs text-[var(--text-muted)] p-4">Loading catalog…</div>
      ) : result.error ? (
        <div className="text-xs text-[var(--error)] p-4">Catalog failed: {result.error}</div>
      ) : result.models.length === 0 ? (
        <div className="text-xs text-[var(--text-muted)] p-4">
          {q ? `No matches for "${q}".` : "No entries."}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
            {shown.map((m: CatalogModel) => (
              <CatalogCard
                key={`${m.provider}:${m.id}`}
                model={m}
                isDefault={isDefault(m.id)}
                onSetDefault={() => onSetDefault(m.id)}
                formatContext={formatContext}
              />
            ))}
          </div>
          {result.models.length > 12 && (
            <button
              type="button"
              className="btn btn-ghost text-xs mt-3"
              onClick={() => setExpanded((e) => !e)}
            >
              {expanded ? "Show fewer" : `Show all ${result.models.length}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function CatalogCard({
  model,
  isDefault,
  onSetDefault,
  formatContext,
}: {
  model: CatalogModel;
  isDefault: boolean;
  onSetDefault: () => void;
  formatContext: (n: number) => string;
}) {
  const price = model.pricing;
  return (
    <div
      className={`rounded-[6px] border ${isDefault ? "border-[var(--accent)]" : "border-[var(--border)]"} bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.04)] transition-colors p-3`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0 flex-1">
          <div
            className="text-xs font-semibold text-[var(--text-primary)] truncate"
            title={model.display_name || model.id}
          >
            {model.display_name || model.id}
          </div>
          <div className="text-[10px] text-[var(--text-muted)] truncate font-mono mt-0.5" title={model.id}>
            {model.id}
          </div>
        </div>
        {isDefault && <Check size={11} className="text-[var(--accent)] flex-shrink-0 mt-1" />}
      </div>
      <div className="flex flex-wrap items-center gap-1 mb-2">
        <span className="badge badge-info text-[9px]">{model.provider}</span>
        {model.family && <span className="badge badge-neutral text-[9px]">{model.family}</span>}
        {model.context_window && (
          <span className="text-[10px] text-[var(--text-muted)]">
            {formatContext(model.context_window)} ctx
          </span>
        )}
      </div>
      {price && (price.prompt_per_mtok > 0 || price.completion_per_mtok > 0) && (
        <div className="text-[10px] text-[var(--text-muted)] font-mono mb-2">
          ${price.prompt_per_mtok.toFixed(2)}/M in · ${price.completion_per_mtok.toFixed(2)}/M out
        </div>
      )}
      {(!price || (price.prompt_per_mtok === 0 && price.completion_per_mtok === 0)) &&
        model.tags?.includes("free") && (
          <div className="text-[10px] text-[var(--success)] mb-2">free</div>
        )}
      <div className="flex items-center gap-2 pt-2 border-t border-[var(--border)]">
        <button
          onClick={onSetDefault}
          className={`btn text-[10px] ${isDefault ? "btn-ghost opacity-60 cursor-default" : "btn-primary"}`}
          disabled={isDefault}
        >
          {isDefault ? "Default" : "Set default"}
        </button>
        <button
          onClick={() => navigator.clipboard.writeText(model.id)}
          className="btn btn-ghost text-[10px]"
          title="Copy id"
        >
          Copy id
        </button>
      </div>
    </div>
  );
}
