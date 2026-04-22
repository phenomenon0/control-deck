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
    const id = setInterval(refetch, 10_000);
    return () => clearInterval(id);
  }, [refetch]);

  return { providers, discovered, loading, refetch };
}
