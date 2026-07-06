"use client";

/**
 * LabPresetIO — save/load knob presets as JSON.
 *
 * Persists to localStorage under `voice-lab.presets`. Seeded with the bundled
 * defaults from `lib/voice-lab/presets/default.json`.
 */

import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { useLabStore, type LabKnobs } from "@/lib/voice-lab/store";
import bundledPresets from "@/lib/voice-lab/presets/default.json";

interface NamedPreset {
  name: string;
  knobs: LabKnobs;
}

const STORAGE_KEY = "voice-lab.presets";

function loadStored(): NamedPreset[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as NamedPreset[];
  } catch {
    /* ignore */
  }
  return [];
}

function saveStored(presets: NamedPreset[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

export function LabPresetIO() {
  const { knobs, loadKnobs } = useLabStore();
  const [presets, setPresets] = useState<NamedPreset[]>(() => {
    const stored = loadStored();
    const merged = [...(bundledPresets as NamedPreset[])];
    for (const p of stored) {
      if (!merged.some((m) => m.name === p.name)) merged.push(p);
    }
    return merged;
  });
  const [name, setName] = useState("");

  const save = useCallback(() => {
    if (!name.trim()) return;
    const next: NamedPreset = { name: name.trim(), knobs };
    const stored = loadStored().filter((p) => p.name !== next.name);
    stored.push(next);
    saveStored(stored);
    setPresets((prev) => {
      const filtered = prev.filter((p) => p.name !== next.name);
      return [...filtered, next];
    });
    setName("");
  }, [knobs, name]);

  const apply = useCallback(
    (preset: NamedPreset) => {
      loadKnobs(preset.knobs);
    },
    [loadKnobs],
  );

  const remove = useCallback((target: NamedPreset) => {
    const stored = loadStored().filter((p) => p.name !== target.name);
    saveStored(stored);
    setPresets((prev) => prev.filter((p) => p.name !== target.name));
  }, []);

  return (
    <div className="space-y-2 text-xs">
      <div className="flex gap-1">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="preset name"
          className="flex-1 rounded border bg-background px-1 py-0.5"
        />
        <Button size="sm" onClick={save} disabled={!name.trim()}>
          save current
        </Button>
      </div>
      <ul className="space-y-1">
        {presets.map((p) => (
          <li key={p.name} className="flex items-center justify-between gap-2 rounded border px-2 py-1">
            <span className="font-mono">{p.name}</span>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" onClick={() => apply(p)}>
                load
              </Button>
              <Button size="sm" variant="ghost" onClick={() => remove(p)}>
                ✕
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
