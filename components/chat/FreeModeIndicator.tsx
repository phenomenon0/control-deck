"use client";

/**
 * Free-tier roulette toggle pill.
 *
 * Shows "Free 🎯 {activeModel} · {rpmRemaining}" when on. Click to toggle.
 * Hovering opens a popover with the full catalog + remaining quotas for
 * each model, so you can see at a glance which free model just served
 * your request and how much runway each still has.
 *
 * When OFF, renders as a tiny dimmed "Free" pill. When ON without
 * OPENROUTER_API_KEY set, shows a warning state so the user knows the
 * toggle won't route anything until they add a key.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, AlertTriangle, RefreshCw } from "lucide-react";
import { useDeckSettings } from "@/components/settings/DeckSettingsProvider";

type Provider = "openrouter" | "nvidia";

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
    kept: number;
    removed: number;
    error?: string;
    at: number;
  } | null;
}

function formatContext(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export function FreeModeIndicator() {
  const { prefs, updatePrefs } = useDeckSettings();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  const reload = useCallback(async () => {
    const r = await fetch("/api/free-tier/status", { cache: "no-store" }).catch(() => null);
    if (r?.ok) setStatus((await r.json()) as StatusResponse);
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetch("/api/free-tier/refresh", { method: "POST" }).catch(() => null);
      await reload();
    } finally {
      setRefreshing(false);
    }
  }, [reload]);

  useEffect(() => {
    if (!prefs.freeMode) return;
    reload();
    const iv = setInterval(reload, 10_000);
    return () => clearInterval(iv);
  }, [prefs.freeMode, reload]);

  useEffect(() => {
    if (!open) return;
    reload();
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
  }, [open, reload]);

  const toggle = () => {
    updatePrefs({ freeMode: !prefs.freeMode });
  };

  const active = status?.status.find((s) => s.model.id === status.activeModelId);
  const noKey = prefs.freeMode && status && !status.enabled;
  const byProvider = status?.status.reduce<Record<Provider, StatusEntry[]>>(
    (acc, s) => {
      (acc[s.model.provider] ||= []).push(s);
      return acc;
    },
    { openrouter: [], nvidia: [] },
  );
  const lastRefreshMins = status?.lastRefreshAt
    ? Math.floor((Date.now() - status.lastRefreshAt) / 60_000)
    : null;

  return (
    <div className="composer-free-pill" ref={ref}>
      <button
        type="button"
        className={`composer-tweaks-launch${prefs.freeMode ? " is-open" : ""}${noKey ? " has-warning" : ""}`}
        onClick={prefs.freeMode ? () => setOpen((o) => !o) : toggle}
        onContextMenu={(e) => {
          e.preventDefault();
          toggle();
        }}
        title={
          prefs.freeMode
            ? `Free mode on — click for details, right-click to turn off${noKey ? " (OPENROUTER_API_KEY missing!)" : ""}`
            : "Free mode off — click to route via OpenRouter free tier"
        }
      >
        {noKey ? <AlertTriangle size={14} /> : <Sparkles size={14} />}
        <span>Free</span>
        {prefs.freeMode && active && (
          <>
            <span className="composer-free-sep">·</span>
            <span className="composer-free-model">{active.model.displayName}</span>
            <span className="composer-free-quota">{active.remainingRpm}/{active.model.rateLimits.rpm}</span>
          </>
        )}
      </button>

      {open && prefs.freeMode && status && (
        <div className="composer-tweaks-panel composer-free-panel" role="dialog" aria-label="Free tier status">
          <div className="composer-model-head">
            <span className="composer-tweaks-axis-label">Free-tier roulette</span>
            <div className="composer-free-actions">
              <button
                type="button"
                className="composer-free-off"
                onClick={refresh}
                disabled={refreshing}
                title={lastRefreshMins !== null ? `Last refreshed ${lastRefreshMins}m ago` : "Hunt for new free models"}
              >
                <RefreshCw size={10} className={refreshing ? "composer-free-spin" : undefined} />
                Hunt
              </button>
              <button type="button" className="composer-free-off" onClick={toggle}>
                Turn off
              </button>
            </div>
          </div>

          <div className="composer-free-providers">
            <span className={`composer-free-provider-chip${status.providers.openrouter ? " is-on" : ""}`}>
              OpenRouter {status.providers.openrouter ? "✓" : "· key missing"}
            </span>
            <span className={`composer-free-provider-chip${status.providers.nvidia ? " is-on" : ""}`}>
              NVIDIA {status.providers.nvidia ? "✓" : "· key missing"}
            </span>
          </div>

          {noKey && (
            <p className="composer-free-warning">
              <AlertTriangle size={12} /> Set <code>OPENROUTER_API_KEY</code> and/or <code>NVIDIA_API_KEY</code>.
            </p>
          )}
          {!noKey && (
            <p className="composer-free-note">
              Prompts may be used for training. Don&apos;t route sensitive threads here.
              {status.lastRefreshResult?.ok === false && (
                <span className="composer-free-stale"> · last refresh failed: {status.lastRefreshResult.error}</span>
              )}
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
                    const isActive = model.id === status.activeModelId;
                    return (
                      <li key={model.id}>
                        <div className={`composer-model-row${isActive ? " is-active" : ""}${locked ? " is-locked" : ""}`}>
                          <div className="composer-model-row-main">
                            <span className="composer-model-row-name">{model.displayName}</span>
                            {isActive && <span className="composer-model-hot">ACTIVE</span>}
                            {locked && <span className="composer-free-locked">{lockReason}</span>}
                          </div>
                          <div className="composer-model-row-meta">
                            {formatContext(model.contextWindow)} ctx · {model.modality} · {remainingRpm}/{model.rateLimits.rpm} rpm · {remainingRpd}/{model.rateLimits.rpd} rpd
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
