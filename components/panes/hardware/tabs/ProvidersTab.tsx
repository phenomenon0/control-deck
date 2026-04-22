"use client";

import { useState } from "react";
import type { ProviderSnapshot } from "@/lib/hardware/providers/types";
import type { DiscoveredProvider } from "@/lib/hardware/providers/detected-probes";

/**
 * ProvidersTab — cross-ecosystem status, now interactive.
 *
 * Each online provider lists its resident + installed models. Every model
 * row gets Load / Unload buttons when the adapter reports the capability.
 * Disabled capability is still surfaced (greyed button + reason tooltip)
 * so the user sees *why* vLLM / llama.cpp can't swap on the fly.
 */
export function ProvidersTab({
  providers,
  discovered,
  onAction,
}: {
  providers: ProviderSnapshot[];
  discovered: DiscoveredProvider[];
  onAction?: (providerId: string, action: "load" | "unload", model: string) => Promise<void>;
}) {
  const detected = discovered.filter((d) => d.detected);

  return (
    <>
      <section className="hardware-panel">
        <header>
          <h2>Providers</h2>
          <span className="hardware-panel-meta">
            {providers.filter((p) => p.health.online).length}/{providers.length} online
          </span>
        </header>
        <ul className="hardware-providers">
          {providers.map((p) => (
            <li
              key={p.id}
              className={`hardware-provider hardware-provider--${p.health.online ? "on" : "off"}`}
            >
              <div className="hardware-provider-head">
                <span
                  className={`hardware-provider-dot hardware-provider-dot--${p.health.online ? "on" : "off"}`}
                />
                <span className="hardware-provider-label">{p.label}</span>
                <span className="hardware-provider-origin">{p.origin}</span>
                <code className="hardware-provider-url">{p.url}</code>
                {p.health.latencyMs !== undefined && (
                  <span className="hardware-provider-latency">{p.health.latencyMs}ms</span>
                )}
                <CapabilityBadges p={p} />
              </div>
              {p.health.online && (
                <ProviderModels provider={p} onAction={onAction} />
              )}
            </li>
          ))}
        </ul>
      </section>

      {detected.length > 0 && (
        <section className="hardware-panel">
          <header>
            <h2>Also detected</h2>
            <span className="hardware-panel-meta">
              {detected.length} hit{detected.length === 1 ? "" : "s"} · {discovered.length} probed
            </span>
          </header>
          <ul className="hardware-discovered">
            {detected.map((d) => (
              <li key={d.id}>
                <span className="hardware-discovered-label">{d.label}</span>
                <span className="hardware-discovered-origin">{d.origin}</span>
                <code className="hardware-discovered-target">{d.target}</code>
                <span className="hardware-discovered-kind">{d.kind === "http-probe" ? "port" : "disk"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function CapabilityBadges({ p }: { p: ProviderSnapshot }) {
  return (
    <span className="hardware-provider-caps">
      <span
        className={`hardware-cap hardware-cap--${p.capabilities.load ? "on" : "off"}`}
        title={p.capabilities.load ? "Load supported" : (p.capabilities.loadReason ?? "Load unsupported")}
      >
        load
      </span>
      <span
        className={`hardware-cap hardware-cap--${p.capabilities.unload ? "on" : "off"}`}
        title={p.capabilities.unload ? "Unload supported" : (p.capabilities.unloadReason ?? "Unload unsupported")}
      >
        unload
      </span>
    </span>
  );
}

function ProviderModels({
  provider,
  onAction,
}: {
  provider: ProviderSnapshot;
  onAction?: (providerId: string, action: "load" | "unload", model: string) => Promise<void>;
}) {
  const loaded = new Set(provider.loaded.map((m) => m.name));
  // Merge: installed models plus any loaded-but-not-in-installed-list (rare
  // for LM Studio's model_id case).
  const allNames = new Set<string>();
  provider.installed.forEach((m) => allNames.add(m.name));
  provider.loaded.forEach((m) => allNames.add(m.name));
  if (allNames.size === 0) {
    return (
      <div className="hardware-provider-meta">
        <span>no models</span>
      </div>
    );
  }

  const rows = [...allNames].sort();
  return (
    <ul className="hardware-provider-models">
      {rows.slice(0, 20).map((name) => {
        const isLoaded = loaded.has(name);
        return (
          <li key={name}>
            <span className="hardware-provider-model-name">{name}</span>
            {isLoaded && <span className="hardware-badge hardware-badge--hot">HOT</span>}
            <ActionButton
              provider={provider}
              action="load"
              model={name}
              isLoaded={isLoaded}
              onAction={onAction}
            />
            <ActionButton
              provider={provider}
              action="unload"
              model={name}
              isLoaded={isLoaded}
              onAction={onAction}
            />
          </li>
        );
      })}
      {rows.length > 20 && (
        <li className="hardware-offline-more">
          … and {rows.length - 20} more. Use the Models tab for the full list.
        </li>
      )}
    </ul>
  );
}

function ActionButton({
  provider,
  action,
  model,
  isLoaded,
  onAction,
}: {
  provider: ProviderSnapshot;
  action: "load" | "unload";
  model: string;
  isLoaded: boolean;
  onAction?: (providerId: string, action: "load" | "unload", model: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const supported = provider.capabilities[action];
  const reason =
    action === "load" ? provider.capabilities.loadReason : provider.capabilities.unloadReason;

  // Load is only meaningful when not loaded; unload only when loaded.
  const stateAllows = action === "load" ? !isLoaded : isLoaded;
  const disabled = !supported || !stateAllows || busy;

  const run = async () => {
    if (disabled || !onAction) return;
    setBusy(true);
    try {
      await onAction(provider.id, action, model);
    } finally {
      setBusy(false);
    }
  };

  const tooltip = !supported
    ? reason ?? `${provider.label} does not support ${action}`
    : !stateAllows
      ? action === "load"
        ? "Already loaded"
        : "Not currently loaded"
      : `${action} ${model}`;

  return (
    <button
      type="button"
      className={`hardware-btn hardware-btn--${action === "load" ? "primary" : "ghost"} hardware-provider-action`}
      onClick={run}
      disabled={disabled}
      title={tooltip}
    >
      {busy ? "…" : action}
    </button>
  );
}
