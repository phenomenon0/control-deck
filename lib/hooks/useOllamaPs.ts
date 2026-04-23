"use client";

/**
 * Poll /api/ollama/ps to show currently-loaded Ollama models in VRAM.
 * 8s interval is plenty — loads/unloads aren't high-frequency.
 */

import { useCallback, useEffect, useState } from "react";
import type { LoadedOllamaModel } from "@/app/api/ollama/ps/route";

interface Result {
  models: LoadedOllamaModel[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  unload: (name: string) => Promise<void>;
}

export function useOllamaPs(): Result {
  const [models, setModels] = useState<LoadedOllamaModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch("/api/ollama/ps", { cache: "no-store" });
      if (!res.ok) {
        setError(`ps ${res.status}`);
        setModels([]);
        return;
      }
      const data = (await res.json()) as { models: LoadedOllamaModel[] };
      setModels(data.models ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "fetch failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const unload = useCallback(
    async (name: string) => {
      await fetch("/api/ollama/ps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      await refetch();
    },
    [refetch],
  );

  useEffect(() => {
    refetch();
    const id = setInterval(refetch, 8_000);
    return () => clearInterval(id);
  }, [refetch]);

  return { models, loading, error, refetch, unload };
}
