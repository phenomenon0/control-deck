"use client";
import { useState, useEffect, useCallback } from "react";

// Module-level singleton so multiple components share one fetch
let globalModels: string[] = [];
let globalLoading = true;
let listeners = new Set<() => void>();
let subscriberCount = 0;
let fetched = false;

async function fetchModels() {
  globalLoading = true;
  notify();

  try {
    // Try unified backend first
    const backendRes = await fetch("/api/backend");
    if (backendRes.ok) {
      const data = await backendRes.json();
      if (data.models?.length) {
        globalModels = data.models;
        globalLoading = false;
        notify();
        return;
      }
    }

    // Fallback to Ollama directly
    const ollamaRes = await fetch("/api/ollama/tags");
    if (ollamaRes.ok) {
      const data = await ollamaRes.json();
      if (data.models) {
        globalModels = data.models.map((m: { name: string }) => m.name);
      }
    }
  } catch {
    // Silently fail - consumers will see an empty list
  } finally {
    globalLoading = false;
    fetched = true;
    notify();
  }
}

function notify() {
  listeners.forEach((fn) => fn());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  subscriberCount++;

  if (subscriberCount === 1 && !fetched) {
    fetchModels();
  }

  return () => {
    listeners.delete(listener);
    subscriberCount--;

    if (subscriberCount === 0) {
      // Reset so we re-fetch if components re-mount later
      fetched = false;
      globalModels = [];
      globalLoading = true;
    }
  };
}

export function useModels() {
  const [models, setModels] = useState<string[]>(globalModels);
  const [loading, setLoading] = useState<boolean>(globalLoading);

  useEffect(() => {
    const unsubscribe = subscribe(() => {
      setModels(globalModels);
      setLoading(globalLoading);
    });

    // Sync with current values in case already fetched
    setModels(globalModels);
    setLoading(globalLoading);

    return unsubscribe;
  }, []);

  const refresh = useCallback(() => {
    fetched = false;
    fetchModels();
  }, []);

  return { models, loading, refresh };
}
