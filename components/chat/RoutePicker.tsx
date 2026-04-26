"use client";

/**
 * Local-only model picker — llama.cpp edition.
 *
 * llama-server binds one model per process, so the picker is informational
 * here: it shows what llama-server reports on /v1/models. Switching models
 * means restarting the server with a different GGUF (operator action), not
 * an in-band /api call. We surface a "Reload server" hint when llama.cpp
 * is unreachable.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Cpu, RefreshCw } from "lucide-react";
import { useDeckSettings } from "@/components/settings/DeckSettingsProvider";

interface LlamacppStatus {
  online: boolean;
  url: string;
  latencyMs?: number;
  modelId?: string;
  models?: string[];
  error?: string;
}

export function RoutePicker() {
  const { prefs, updatePrefs } = useDeckSettings();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<LlamacppStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/llamacpp/status", { cache: "no-store" }).catch(
        () => null,
      );
      const s = res?.ok
        ? ((await res.json()) as LlamacppStatus)
        : ({ online: false, url: "" } as LlamacppStatus);
      setStatus(s);
    } finally {
      setBusy(false);
    }
  }, []);

  const models = status?.models ?? [];

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    void refresh();
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
  }, [open, refresh]);

  const launch = async () => {
    setBusy(true);
    try {
      await fetch("/api/llamacpp/launch", { method: "POST" });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const pick = (id: string) => {
    updatePrefs({ model: id, localModel: id });
  };

  const active =
    prefs.model || status?.modelId || models[0] || (status?.online ? "no model" : "llama.cpp down");
  const down = status !== null && !status.online;

  return (
    <div className="composer-route-pill" ref={ref}>
      <button
        type="button"
        className={`composer-tweaks-launch${open ? " is-open" : ""}${down ? " has-warning" : ""}`}
        onClick={() => setOpen((o) => !o)}
        title={
          down
            ? "llama.cpp not reachable — click to launch llama-server"
            : `llama.cpp — ${active}`
        }
        aria-expanded={open}
      >
        {down ? <AlertTriangle size={14} /> : <Cpu size={14} />}
        <span className="composer-route-mode">Local</span>
        <span className="composer-free-sep">·</span>
        <span className="composer-model-name">{active}</span>
      </button>

      {open && (
        <div
          className="composer-tweaks-panel composer-route-panel"
          role="dialog"
          aria-label="Local model picker"
        >
          <div className="composer-model-head">
            <span className="composer-tweaks-axis-label">llama.cpp models</span>
            <button
              type="button"
              className="composer-mini-btn"
              onClick={() => void refresh()}
              disabled={busy}
              title="Refresh"
            >
              <RefreshCw size={11} />
            </button>
          </div>

          {down && (
            <div className="composer-model-hint">
              <p>llama-server isn&apos;t running on {status?.url ?? "localhost:8080"}.</p>
              <button
                type="button"
                className="composer-mini-btn"
                onClick={() => void launch()}
                disabled={busy}
              >
                {busy ? "Launching…" : "Launch llama-server"}
              </button>
            </div>
          )}

          {!down && models.length === 0 && (
            <p className="composer-model-hint">
              llama-server is up but reported no models. Check{" "}
              <code>~/.local/state/control-deck/llamacpp.log</code>.
            </p>
          )}

          {!down && models.length > 0 && (
            <ul className="composer-model-list">
              {models.map((id) => {
                const isActive = id === active;
                return (
                  <li key={id}>
                    <button
                      type="button"
                      className={`composer-model-row${isActive ? " is-active" : ""}`}
                      onClick={() => pick(id)}
                    >
                      <div className="composer-model-row-main">
                        <span className="composer-model-row-name">{id}</span>
                        {isActive && <span className="composer-model-active-dot" />}
                      </div>
                      <div className="composer-model-row-meta">
                        served by llama-server
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <p className="composer-model-hint" style={{ marginTop: 8, opacity: 0.7 }}>
            llama-server binds one model per process. To switch models, set{" "}
            <code>LLAMACPP_MODEL_PATH</code> and restart.
          </p>
        </div>
      )}
    </div>
  );
}
