"use client";

/**
 * Local-only model picker.
 *
 * Chat is local-first by design — there is no Free or Cloud tab here.
 * The pill shows the active Ollama model with a HOT badge when it's
 * resident in VRAM; clicking opens the LocalModelPanel popover for
 * switching/discovering local models. Picking a model writes
 * `prefs.model` and preloads it via /api/hardware/providers/action.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Cpu } from "lucide-react";
import { useDeckSettings } from "@/components/settings/DeckSettingsProvider";
import { LocalModelPanel } from "@/components/chat/LocalModelPanel";
import { waitForVramResident, listOtherResidentModels } from "@/lib/hardware/ollama-utils";

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

export function RoutePicker() {
  const { prefs, updatePrefs } = useDeckSettings();
  const [open, setOpen] = useState(false);
  const [ollamaTags, setOllamaTags] = useState<OllamaTag[]>([]);
  const [ollamaLoaded, setOllamaLoaded] = useState<LoadedModel[]>([]);
  const [ollamaReachable, setOllamaReachable] = useState<boolean>(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [localView, setLocalView] = useState<"installed" | "discover">("installed");
  const [loadWarning, setLoadWarning] = useState<{
    target: string;
    blockers: { name: string; size_vram?: number }[];
  } | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  const loadOllama = useCallback(async () => {
    const [tagsRes, psRes] = await Promise.all([
      fetch("/api/ollama/tags", { cache: "no-store" }).catch(() => null),
      fetch("/api/ollama/ps", { cache: "no-store" }).catch(() => null),
    ]);
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

  useEffect(() => {
    if (!open) return;
    if (ollamaReachable && ollamaTags.length === 0) setLocalView("discover");
    else if (ollamaTags.length > 0) setLocalView((v) => (v === "discover" ? v : "installed"));
  }, [open, ollamaReachable, ollamaTags.length]);

  useEffect(() => {
    if (!open) return;
    loadOllama();
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
  }, [open, loadOllama]);

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
      if (loadWarning?.target) {
        void pickOllama(loadWarning.target);
      }
    }
  };

  const loadedNames = new Set(ollamaLoaded.map((m) => m.name));
  const ollamaCurrent =
    prefs.model ||
    ollamaLoaded[0]?.name ||
    ollamaTags.find(
      (m) =>
        m.details?.family !== "bert" &&
        m.details?.family !== "nomic-bert" &&
        !m.name.toLowerCase().includes("embed"),
    )?.name ||
    ollamaTags[0]?.name ||
    (!ollamaReachable ? "ollama down" : "no model");

  const localDown = !ollamaReachable;

  return (
    <div className="composer-route-pill" ref={ref}>
      <button
        type="button"
        className={`composer-tweaks-launch${open ? " is-open" : ""}${localDown ? " has-warning" : ""}`}
        onClick={() => setOpen((o) => !o)}
        title={
          localDown
            ? "Ollama daemon not reachable — run `ollama serve`"
            : `Local route — ${ollamaCurrent}${loadedNames.has(ollamaCurrent) ? " (in VRAM)" : ""}`
        }
        aria-expanded={open}
      >
        {localDown ? <AlertTriangle size={14} /> : <Cpu size={14} />}
        <span className="composer-route-mode">Local</span>
        <span className="composer-free-sep">·</span>
        <span className="composer-model-name">{ollamaCurrent}</span>
        {loadedNames.has(ollamaCurrent) && <span className="composer-model-hot">HOT</span>}
      </button>

      {open && (
        <div
          className="composer-tweaks-panel composer-route-panel"
          role="dialog"
          aria-label="Local model picker"
        >
          <div className="composer-model-head">
            <span className="composer-tweaks-axis-label">Local model</span>
          </div>
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
        </div>
      )}
    </div>
  );
}
