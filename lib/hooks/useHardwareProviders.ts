"use client";

import { useCallback, useEffect, useState } from "react";
import type { ProviderSnapshot } from "@/lib/hardware/providers/types";
import type { DiscoveredProvider } from "@/lib/hardware/providers/detected-probes";

interface Result {
  providers: ProviderSnapshot[];
  discovered: DiscoveredProvider[];
  loading: boolean;
  refetch: () => Promise<void>;
}

export function useHardwareProviders(): Result {
  const [providers, setProviders] = useState<ProviderSnapshot[]>([]);
  const [discovered, setDiscovered] = useState<DiscoveredProvider[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch("/api/hardware/providers", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as {
        providers: ProviderSnapshot[];
        discovered: DiscoveredProvider[];
      };
      setProviders(data.providers ?? []);
      setDiscovered(data.discovered ?? []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
    // Hidden tabs don't need polling. setInterval keeps firing in background
    // tabs on Chrome/Edge and burns CPU on every desktop — especially Mac,
    // where each sweep shells out to ioreg + ps.
    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (id !== null) return;
      id = setInterval(refetch, 60_000);
    };
    const stop = () => {
      if (id !== null) {
        clearInterval(id);
        id = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        refetch();
        start();
      } else {
        stop();
      }
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refetch]);

  return { providers, discovered, loading, refetch };
}
