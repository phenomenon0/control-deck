"use client";

/**
 * In-chat model picker. Renders as a compact pill next to the composer's
 * Tweaks button. Click to open a popover with every installed Ollama model
 * + load state. Selecting a model:
 *   1. Updates the active model in DeckSettingsProvider (persisted to
 *      localStorage).
 *   2. Fires /api/hardware/providers/action to pre-load it into VRAM.
 *   3. Next chat turn uses it immediately via the `model` field on POST.
 *
 * The "swap" affordance the user asked for — you don't need to go to the
 * Hardware or Models pane to change your chat model.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Cpu } from "lucide-react";
import { useDeckSettings } from "@/components/settings/DeckSettingsProvider";

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

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function ComposerModelPicker() {
  const { prefs, updatePrefs } = useDeckSettings();
  const [open, setOpen] = useState(false);
  const [tags, setTags] = useState<OllamaTag[]>([]);
  const [loaded, setLoaded] = useState<LoadedModel[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  const reload = useCallback(async () => {
    const [tagsRes, psRes] = await Promise.all([
      fetch("/api/ollama/tags", { cache: "no-store" }).catch(() => null),
      fetch("/api/ollama/ps", { cache: "no-store" }).catch(() => null),
    ]);
    if (tagsRes?.ok) {
      const d = (await tagsRes.json()) as { models: OllamaTag[] };
      setTags(d.models ?? []);
    }
    if (psRes?.ok) {
      const d = (await psRes.json()) as { models: LoadedModel[] };
      setLoaded(d.models ?? []);
    }
  }, []);

  useEffect(() => {
    if (open) reload();
  }, [open, reload]);

  useEffect(() => {
    if (!open) return;
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
  }, [open]);

  const pick = async (name: string) => {
    updatePrefs({ model: name });
    setBusy(name);
    try {
      await fetch("/api/hardware/providers/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: "ollama", action: "load", model: name }),
      });
      await reload();
    } finally {
      setBusy(null);
    }
  };

  const loadedNames = new Set(loaded.map((m) => m.name));
  // When prefs.model is empty (fresh install or post-migration wipe),
  // display the first loaded-in-VRAM model, then the first installed one,
  // so the pill shows something real instead of "undefined".
  const current =
    prefs.model ||
    loaded[0]?.name ||
    tags.find(
      (m) =>
        m.details?.family !== "bert" &&
        m.details?.family !== "nomic-bert" &&
        !m.name.toLowerCase().includes("embed"),
    )?.name ||
    tags[0]?.name ||
    "no model";

  // When free mode is on, the Ollama pick is preserved in prefs but the
  // chat won't actually route through Ollama. Signal that visually so
  // users don't think their selection is active.
  const suspended = prefs.freeMode;

  return (
    <div className="composer-model-picker" ref={ref}>
      <button
        type="button"
        className={`composer-tweaks-launch${open ? " is-open" : ""}${suspended ? " is-suspended" : ""}`}
        onClick={() => setOpen((o) => !o)}
        title={
          suspended
            ? `Free mode active — Ollama selection (${current}) suspended until turned off`
            : `Active model: ${current}${loadedNames.has(current) ? " (in VRAM)" : ""}`
        }
        aria-expanded={open}
      >
        <Cpu size={16} />
        <span className="composer-model-name">{current}</span>
        {loadedNames.has(current) && !suspended && <span className="composer-model-hot">HOT</span>}
        {suspended && <span className="composer-model-suspended">paused</span>}
      </button>

      {open && (
        <div className="composer-tweaks-panel composer-model-panel" role="dialog" aria-label="Model picker">
          <div className="composer-model-head">
            <span className="composer-tweaks-axis-label">Ollama models</span>
            {tags.length === 0 && (
              <span className="composer-model-hint">
                No Ollama models installed. Pull one from Hardware.
              </span>
            )}
          </div>
          <ul className="composer-model-list">
            {tags.map((m) => {
              const isActive = m.name === current;
              const isLoaded = loadedNames.has(m.name);
              const isBusy = busy === m.name;
              return (
                <li key={m.name}>
                  <button
                    type="button"
                    className={`composer-model-row${isActive ? " is-active" : ""}`}
                    onClick={() => pick(m.name)}
                    disabled={isBusy}
                  >
                    <div className="composer-model-row-main">
                      <span className="composer-model-row-name">{m.name}</span>
                      {isLoaded && <span className="composer-model-hot">HOT</span>}
                      {isActive && <span className="composer-model-active-dot" />}
                    </div>
                    <div className="composer-model-row-meta">
                      {m.details?.parameter_size ?? "?"} · {m.details?.quantization_level ?? ""} · {formatSize(m.size)}
                      {isBusy && <span> · loading…</span>}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
