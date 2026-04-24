"use client";

/**
 * Shared pull-progress store for Ollama models.
 *
 * Every surface (RoutePicker discover grid, ModelsTab, LocalSuggestionsStrip)
 * reads from the same Map so starting a pull in one place shows live
 * progress everywhere. Keyed by Ollama tag string. A second `pull(tag)`
 * while one is in-flight dedupes onto the existing progress record.
 *
 * Protocol: POST /api/ollama/tags returns NDJSON lines of
 *   { status, digest?, total?, completed? }
 * plus an occasional `{ status: "heartbeat" }` that we ignore.
 * Terminal states: status === "success" → phase "done"; any HTTP error
 * or JSON `error` field → phase "error".
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type PullPhase = "queued" | "pulling" | "done" | "error" | "aborted";

export interface LayerProgress {
  total: number;
  completed: number;
}

export interface PullProgress {
  tag: string;
  phase: PullPhase;
  statusLine: string;
  layers: Map<string, LayerProgress>;
  overallPct: number;
  bytesPerSec: number;
  error: string | null;
  startedAt: number;
  updatedAt: number;
  abort: () => void;
}

interface InternalEntry {
  progress: PullProgress;
  controller: AbortController;
  lastBytes: number;
  lastTickAt: number;
  /** Resolves when `runPull` settles (success, error, or abort). */
  done: Promise<void>;
}

const store = new Map<string, InternalEntry>();
const listeners = new Set<() => void>();

function snapshot(): Map<string, PullProgress> {
  const out = new Map<string, PullProgress>();
  store.forEach((entry, tag) => out.set(tag, entry.progress));
  return out;
}

function notify() {
  listeners.forEach((fn) => fn());
}

function computeOverallPct(layers: Map<string, LayerProgress>): number {
  let total = 0;
  let completed = 0;
  layers.forEach((l) => {
    total += l.total;
    completed += Math.min(l.completed, l.total);
  });
  if (total === 0) return 0;
  return Math.min(100, Math.max(0, (completed / total) * 100));
}

async function runPull(tag: string, entry: InternalEntry) {
  const decoder = new TextDecoder();
  let buf = "";

  try {
    const res = await fetch("/api/ollama/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: tag }),
      signal: entry.controller.signal,
    });

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      entry.progress = {
        ...entry.progress,
        phase: "error",
        error: text || `pull failed (${res.status})`,
        updatedAt: Date.now(),
      };
      notify();
      return;
    }

    entry.progress = { ...entry.progress, phase: "pulling", updatedAt: Date.now() };
    notify();

    const reader = res.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let nl = buf.indexOf("\n");
      while (nl !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) handleLine(tag, entry, line);
        nl = buf.indexOf("\n");
      }
    }

    // Flush any trailing line
    const tail = buf.trim();
    if (tail) handleLine(tag, entry, tail);

    if (entry.progress.phase !== "error" && entry.progress.phase !== "aborted") {
      entry.progress = {
        ...entry.progress,
        phase: "done",
        overallPct: 100,
        statusLine: entry.progress.statusLine || "success",
        updatedAt: Date.now(),
      };
      notify();
    }
  } catch (err) {
    if (entry.controller.signal.aborted) {
      entry.progress = { ...entry.progress, phase: "aborted", updatedAt: Date.now() };
    } else {
      entry.progress = {
        ...entry.progress,
        phase: "error",
        error: err instanceof Error ? err.message : "pull failed",
        updatedAt: Date.now(),
      };
    }
    notify();
  }
}

function handleLine(tag: string, entry: InternalEntry, line: string) {
  let msg: {
    status?: string;
    digest?: string;
    total?: number;
    completed?: number;
    error?: string;
  };
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }

  if (msg.status === "heartbeat") return;

  if (msg.error) {
    entry.progress = {
      ...entry.progress,
      phase: "error",
      error: msg.error,
      updatedAt: Date.now(),
    };
    notify();
    return;
  }

  const layers = new Map(entry.progress.layers);
  if (msg.digest && typeof msg.total === "number") {
    layers.set(msg.digest, {
      total: msg.total,
      completed: Math.min(msg.total, msg.completed ?? 0),
    });
  }

  const overallPct = computeOverallPct(layers);
  let totalCompleted = 0;
  layers.forEach((l) => (totalCompleted += Math.min(l.completed, l.total)));

  const now = Date.now();
  const dtSec = Math.max(0.001, (now - entry.lastTickAt) / 1000);
  const deltaBytes = Math.max(0, totalCompleted - entry.lastBytes);
  // EMA with ~2s memory (alpha = dt / (2 + dt))
  const instantBps = deltaBytes / dtSec;
  const alpha = dtSec / (2 + dtSec);
  const bytesPerSec = entry.progress.bytesPerSec * (1 - alpha) + instantBps * alpha;

  entry.lastBytes = totalCompleted;
  entry.lastTickAt = now;

  entry.progress = {
    ...entry.progress,
    phase: msg.status === "success" ? "done" : "pulling",
    statusLine: msg.status ?? entry.progress.statusLine,
    layers,
    overallPct: msg.status === "success" ? 100 : overallPct,
    bytesPerSec,
    updatedAt: now,
  };
  notify();
}

function startPull(tag: string): InternalEntry {
  const existing = store.get(tag);
  if (existing && (existing.progress.phase === "queued" || existing.progress.phase === "pulling")) {
    return existing;
  }

  const controller = new AbortController();
  const now = Date.now();
  const entry: InternalEntry = {
    progress: {
      tag,
      phase: "queued",
      statusLine: "starting",
      layers: new Map(),
      overallPct: 0,
      bytesPerSec: 0,
      error: null,
      startedAt: now,
      updatedAt: now,
      abort: () => {
        controller.abort();
      },
    },
    controller,
    lastBytes: 0,
    lastTickAt: now,
    // Placeholder; replaced immediately below so callers can await it.
    done: Promise.resolve(),
  };
  store.set(tag, entry);
  notify();
  entry.done = runPull(tag, entry);
  return entry;
}

export interface UseModelPull {
  pull: (tag: string) => Promise<void>;
  abort: (tag: string) => void;
  clear: (tag: string) => void;
  progress: Map<string, PullProgress>;
  progressFor: (tag: string) => PullProgress | undefined;
  isPulling: (tag: string) => boolean;
}

export function useModelPull(): UseModelPull {
  const [progress, setProgress] = useState<Map<string, PullProgress>>(() => snapshot());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const listener = () => {
      if (mountedRef.current) setProgress(snapshot());
    };
    listeners.add(listener);
    // Sync in case something landed between render and effect
    setProgress(snapshot());
    return () => {
      mountedRef.current = false;
      listeners.delete(listener);
    };
  }, []);

  const pull = useCallback((tag: string): Promise<void> => {
    if (!tag) return Promise.resolve();
    return startPull(tag).done;
  }, []);

  const abort = useCallback((tag: string) => {
    const entry = store.get(tag);
    if (!entry) return;
    entry.controller.abort();
  }, []);

  const clear = useCallback((tag: string) => {
    const entry = store.get(tag);
    if (!entry) return;
    if (entry.progress.phase === "pulling" || entry.progress.phase === "queued") {
      entry.controller.abort();
    }
    store.delete(tag);
    notify();
  }, []);

  const progressFor = useCallback(
    (tag: string) => progress.get(tag),
    [progress],
  );

  const isPulling = useCallback(
    (tag: string) => {
      const p = progress.get(tag);
      return p?.phase === "queued" || p?.phase === "pulling";
    },
    [progress],
  );

  return { pull, abort, clear, progress, progressFor, isPulling };
}
