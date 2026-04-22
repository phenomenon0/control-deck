"use client";

import { useCallback, useEffect, useState } from "react";
import type { DiskSource, OfflineModel } from "@/lib/hardware/offline-scanner";

interface Result {
  models: OfflineModel[];
  bySource: Record<DiskSource, number>;
  totalBytes: number;
  loading: boolean;
  refetch: () => Promise<void>;
}

export function useOfflineModels(): Result {
  const [models, setModels] = useState<OfflineModel[]>([]);
  const [bySource, setBySource] = useState<Record<DiskSource, number>>({
    "ollama-manifest": 0,
    gguf: 0,
    "huggingface-cache": 0,
    "lm-studio-cache": 0,
  });
  const [totalBytes, setTotalBytes] = useState(0);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch("/api/hardware/offline", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as {
        models: OfflineModel[];
        bySource: Record<DiskSource, number>;
        totalBytes: number;
      };
      setModels(data.models ?? []);
      setBySource(data.bySource);
      setTotalBytes(data.totalBytes);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
    // Much lower cadence — disk state changes slowly.
    const id = setInterval(refetch, 60_000);
    return () => clearInterval(id);
  }, [refetch]);

  return { models, bySource, totalBytes, loading, refetch };
}
