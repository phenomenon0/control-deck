"use client";

/**
 * Installer + fit info for the preset pickers (release-QA decision B3).
 * One fetch of /api/models/weights on mount + a slow refresh; consumers
 * render "get 21.5 GB" on missing presets and a fit verdict on the rest.
 */

import { useEffect, useState } from "react";

export type FitVerdict = "ok" | "warn" | "block" | "unknown";

export interface PresetWeightsInfo {
  complete: boolean;
  missing: string[];
  unsourced: string[];
  downloadBytes: number;
  vramEstimateMb: number;
  fit: FitVerdict;
}

export function useWeightsInfo(): Record<string, PresetWeightsInfo> {
  const [presets, setPresets] = useState<Record<string, PresetWeightsInfo>>({});
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/models/weights", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { presets?: Record<string, PresetWeightsInfo> };
        if (!cancelled && data.presets) setPresets(data.presets);
      } catch {
        /* installer info is progressive enhancement */
      }
    };
    void load();
    const t = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);
  return presets;
}

export function fitLabel(fit: FitVerdict | undefined): string {
  switch (fit) {
    case "warn": return " · tight fit";
    case "block": return " · won't fit now";
    default: return "";
  }
}

export function downloadLabel(info: PresetWeightsInfo | undefined): string {
  if (!info || info.complete) return "";
  if (info.downloadBytes <= 0) return " · manual install";
  return ` · get ${(info.downloadBytes / 1024 ** 3).toFixed(1)} GB`;
}
