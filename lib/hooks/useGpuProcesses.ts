"use client";

import { useCallback, useEffect, useState } from "react";
import type { GpuProcess } from "@/lib/hardware/gpu-types";

interface Result {
  processes: GpuProcess[];
  supported: boolean;
  loading: boolean;
  refetch: () => Promise<void>;
}

/** Polls every 6s. Returns `supported: false` on non-NVIDIA machines. */
export function useGpuProcesses(): Result {
  const [processes, setProcesses] = useState<GpuProcess[]>([]);
  const [supported, setSupported] = useState(true);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch("/api/hardware/gpu-processes", { cache: "no-store" });
      if (!res.ok) {
        setSupported(false);
        setProcesses([]);
        return;
      }
      const data = (await res.json()) as { processes: GpuProcess[]; supported: boolean };
      setProcesses(data.processes);
      setSupported(data.supported);
    } catch {
      setSupported(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
    const id = setInterval(refetch, 6_000);
    return () => clearInterval(id);
  }, [refetch]);

  return { processes, supported, loading, refetch };
}
