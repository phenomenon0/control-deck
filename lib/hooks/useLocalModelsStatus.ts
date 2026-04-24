"use client";

/**
 * Typed wrapper around /api/local-models/status.
 *
 * Refetches when the preset changes or the caller nudges `refresh()` (e.g.
 * after a pull completes). Short-polls every 15s so Ollama installs and
 * sidecar availability stay in sync without the user hitting Refresh.
 */

import { useCallback, useEffect, useState } from "react";

import type { LocalModelDefault, LocalPreset } from "@/lib/inference/local-defaults";
import type { Modality } from "@/lib/inference/types";

export interface LocalModalityStatus {
  modality: Modality;
  name: string;
  description: string;
  default: LocalModelDefault;
  installed: boolean;
  canPull: boolean;
  hint: string | null;
}

export interface LocalRunnersStatus {
  ollama: { reachable: boolean; installed: string[] };
  voiceSidecar: { reachable: boolean; wsUrl: string | null };
}

export interface LocalModelsStatus {
  preset: LocalPreset;
  runners: LocalRunnersStatus;
  modalities: LocalModalityStatus[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const POLL_INTERVAL_MS = 15_000;

export function useLocalModelsStatus(preset: LocalPreset = "balanced"): LocalModelsStatus {
  const [data, setData] = useState<Omit<LocalModelsStatus, "loading" | "error" | "refresh"> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/local-models/status?preset=${encodeURIComponent(preset)}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const body = (await res.json()) as Omit<LocalModelsStatus, "loading" | "error" | "refresh">;
      setData(body);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to fetch local models status");
    } finally {
      setLoading(false);
    }
  }, [preset]);

  useEffect(() => {
    setLoading(true);
    void fetchStatus();
    const id = setInterval(fetchStatus, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchStatus]);

  return {
    preset: data?.preset ?? preset,
    runners: data?.runners ?? {
      ollama: { reachable: false, installed: [] },
      voiceSidecar: { reachable: false, wsUrl: null },
    },
    modalities: data?.modalities ?? [],
    loading,
    error,
    refresh: fetchStatus,
  };
}
