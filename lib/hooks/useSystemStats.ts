"use client";
import { useState, useEffect, useCallback } from "react";

export interface GpuStats {
  name: string;
  memoryUsed: number;
  memoryTotal: number;
  memoryPercent: number;
  utilization: number;
  temperature: number;
}

export interface ServiceStatus {
  name: string;
  url: string;
  status: "online" | "offline" | "unknown";
  latencyMs?: number;
  extra?: {
    vectors?: number;
    collections?: number;
    embedder?: string;
    model?: string;
    dimension?: number;
  };
}

export interface SystemStats {
  gpu: GpuStats | null;
  services: ServiceStatus[];
}

// Module-level singleton so multiple components share one poll
let globalStats: SystemStats | null = null;
let listeners = new Set<() => void>();
let intervalId: ReturnType<typeof setInterval> | null = null;
let subscriberCount = 0;

async function fetchStats() {
  try {
    const res = await fetch("/api/system/stats");
    if (res.ok) {
      globalStats = await res.json();
      listeners.forEach(fn => fn());
    }
  } catch (err) {
    console.warn("[useSystemStats] fetch failed:", err);
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  subscriberCount++;
  if (subscriberCount === 1) {
    fetchStats(); // immediate first fetch
    intervalId = setInterval(fetchStats, 10_000);
  }
  return () => {
    listeners.delete(listener);
    subscriberCount--;
    if (subscriberCount === 0 && intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };
}

export function useSystemStats() {
  const [stats, setStats] = useState<SystemStats | null>(globalStats);

  useEffect(() => {
    const unsubscribe = subscribe(() => setStats(globalStats));
    // Sync with current value in case it was already fetched
    if (globalStats) setStats(globalStats);
    return unsubscribe;
  }, []);

  const refresh = useCallback(() => { fetchStats(); }, []);

  return { stats, refresh };
}
