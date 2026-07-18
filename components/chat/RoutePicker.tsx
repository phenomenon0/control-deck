"use client";

// Local-engine model picker. Reads /api/hardware/providers and lets the user
// pick a model from any chat-capable local engine that's online (Ollama /
// llama.cpp / vLLM / LM Studio — ComfyUI is excluded because it serves
// images, not text). Selecting a pill writes `{ providerId, model }` into
// DeckPrefs; ChatSurface threads both into `/api/chat`, which resolves the
// chosen engine's base URL for that turn (per-request, no global mutation).

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Cpu, RefreshCw } from "lucide-react";
import { useDeckSettings } from "@/components/settings/DeckSettingsProvider";
import { useHardwareProviders } from "@/lib/hooks/useHardwareProviders";
import type {
  ProviderId,
  ProviderSnapshot,
} from "@/lib/hardware/providers/types";

const CHAT_CAPABLE: ReadonlySet<ProviderId> = new Set<ProviderId>([
  "ollama",
  "vllm",
  "llamacpp",
  "lm-studio",
]);

function modelsForProvider(p: ProviderSnapshot): string[] {
  const loaded = p.loaded.map((m) => m.name);
  const installed = p.installed.map((m) => m.name);
  return Array.from(new Set([...loaded, ...installed]));
}

export function RoutePicker() {
  const { prefs, updatePrefs } = useDeckSettings();
  const { providers, discovered, loading, refetch } = useHardwareProviders();
  const [open, setOpen] = useState(false);
  const [launching, setLaunching] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  const chatProviders = providers.filter((p) => CHAT_CAPABLE.has(p.id));
  const onlineProviders = chatProviders.filter((p) => p.health.online);
  const offlineProviders = chatProviders.filter((p) => !p.health.online);
  const allDown = chatProviders.length > 0 && onlineProviders.length === 0;

  // Honor the persisted id when online, else prefer an online engine with
  // models, else any online engine. Persisted id is left intact when offline
  // so the user's preference sticks for when their engine returns.
  const stickyProvider = prefs.providerId
    ? onlineProviders.find((p) => p.id === prefs.providerId)
    : undefined;
  const activeProvider: ProviderSnapshot | null =
    stickyProvider ??
    onlineProviders.find((p) => modelsForProvider(p).length > 0) ??
    onlineProviders[0] ??
    null;
  const activeModels = activeProvider ? modelsForProvider(activeProvider) : [];
  const activeModel: string | null = activeProvider
    ? prefs.model && activeModels.includes(prefs.model)
      ? prefs.model
      : (activeProvider.loaded[0]?.name ??
        activeProvider.installed[0]?.name ??
        null)
    : null;

  const pillText = activeProvider
    ? `${activeProvider.label}${activeModel ? ` · ${activeModel}` : ""}`
    : loading && chatProviders.length === 0
      ? "checking engines…"
      : "no engines online";

  useEffect(() => {
    if (!open) return;
    void refetch();
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
  }, [open, refetch]);

  const pick = (providerId: ProviderId, modelName: string) => {
    updatePrefs({ providerId, model: modelName });
  };

  const launchLlamacpp = async () => {
    setLaunching(true);
    try {
      await fetch("/api/llamacpp/launch", { method: "POST" });
      await refetch();
    } finally {
      setLaunching(false);
    }
  };

  const hasLlamacppAdapter = chatProviders.some((p) => p.id === "llamacpp");
  const llamacppOffline = offlineProviders.some((p) => p.id === "llamacpp");
  const detectedHints = discovered.filter((d) => d.detected);

  return (
    <div className="composer-route-pill" ref={ref}>
      <button
        type="button"
        className={`composer-tweaks-launch${open ? " is-open" : ""}${allDown ? " has-warning" : ""}`}
        onClick={() => setOpen((o) => !o)}
        title={
          allDown
            ? "No local inference engines reachable — click for options"
            : activeProvider
              ? `${activeProvider.label} — ${activeModel ?? "no model"}`
              : "Local engines"
        }
        aria-expanded={open}
      >
        {allDown ? <AlertTriangle size={14} /> : <Cpu size={14} />}
        <span className="composer-route-mode">Local</span>
        <span className="composer-free-sep">·</span>
        <span className="composer-model-name">{pillText}</span>
      </button>

      {open && (
        <div
          className="composer-tweaks-panel composer-route-panel"
          role="dialog"
          aria-label="Local engine picker"
        >
          <div className="composer-model-head">
            <span className="composer-tweaks-axis-label">Local engines</span>
            <button
              type="button"
              className="composer-mini-btn"
              onClick={() => void refetch()}
              disabled={loading}
              title="Refresh engines"
            >
              <RefreshCw size={11} />
            </button>
          </div>

          {allDown && (
            <div className="composer-model-hint">
              <p>No local inference engines reachable.</p>
              {detectedHints.length > 0 && (
                <ul className="cd-discovered-list">
                  {detectedHints.map((d) => (
                    <li key={d.id}>
                      <strong>{d.label}</strong>
                      {d.hint ? ` — ${d.hint}` : ` — found at ${d.target}`}
                    </li>
                  ))}
                </ul>
              )}
              {hasLlamacppAdapter && (
                <button
                  type="button"
                  className="composer-mini-btn"
                  onClick={() => void launchLlamacpp()}
                  disabled={launching}
                >
                  {launching ? "Launching…" : "Launch llama-server"}
                </button>
              )}
            </div>
          )}

          {!allDown && (
            <div className="cd-engine-stack">
              {onlineProviders.map((p) => {
                const models = modelsForProvider(p);
                const loadedSet = new Set(p.loaded.map((m) => m.name));
                const countLabel =
                  p.loaded.length > 0
                    ? `${p.loaded.length} loaded · ${p.installed.length} installed`
                    : `${p.installed.length} installed`;
                return (
                  <div key={p.id} className="cd-engine-group">
                    <div className="cd-engine-head">
                      <span className="cd-engine-label">{p.label}</span>
                      <span className="cd-engine-count">{countLabel}</span>
                    </div>
                    {models.length === 0 ? (
                      <p className="cd-engine-empty">
                        {p.label} is up but reported no models.
                      </p>
                    ) : (
                      <div className="cd-engine-grid">
                        {models.map((id) => {
                          const isActive =
                            activeProvider?.id === p.id && id === activeModel;
                          const isLoaded = loadedSet.has(id);
                          return (
                            <button
                              key={`${p.id}:${id}`}
                              type="button"
                              className={[
                                "cd-model-pill",
                                isActive ? "is-active" : "",
                                isLoaded ? "is-loaded" : "",
                              ]
                                .filter(Boolean)
                                .join(" ")}
                              onClick={() => pick(p.id, id)}
                              title={`${p.label} · ${id}${isLoaded ? " (loaded)" : ""}`}
                            >
                              <span className="cd-model-pill-name">{id}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {offlineProviders.length > 0 && (
            <div className="cd-offline-row">
              <span>Offline</span>
              {offlineProviders.map((p) => (
                <span key={p.id} className="cd-offline-chip">
                  {p.label}
                </span>
              ))}
              {hasLlamacppAdapter && llamacppOffline && (
                <button
                  type="button"
                  className="composer-mini-btn"
                  onClick={() => void launchLlamacpp()}
                  disabled={launching}
                >
                  {launching ? "Launching…" : "Launch llama-server"}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
