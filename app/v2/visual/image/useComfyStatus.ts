"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface PresetAvailability {
  available: boolean;
  missing: string[];
  missingNodes: string[];
}

export interface ComfyModelStatus {
  online: boolean;
  presets: Record<string, PresetAvailability>;
}

interface UseComfyStatusResult extends ComfyModelStatus {
  loading: boolean;
  refresh: () => void;
}

const EMPTY_STATUS: ComfyModelStatus = { online: false, presets: {} };

export function useComfyStatus(): UseComfyStatusResult {
  const [status, setStatus] = useState<ComfyModelStatus>(EMPTY_STATUS);
  const [loading, setLoading] = useState(true);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const mountedRef = useRef(false);
  const loadedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    if (inFlightRef.current) return inFlightRef.current;

    const controller = new AbortController();
    abortRef.current = controller;
    if (!loadedRef.current) setLoading(true);

    const promise = (async () => {
      try {
        const res = await fetch("/api/comfy/models", {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await res.json().catch(() => null) as unknown;
        if (!res.ok) throw new Error("model status unavailable");
        if (!mountedRef.current) return;
        setStatus(normalizeStatus(data));
        loadedRef.current = true;
      } catch {
        if (!mountedRef.current || controller.signal.aborted) return;
        setStatus(EMPTY_STATUS);
        loadedRef.current = true;
      } finally {
        if (mountedRef.current) setLoading(false);
        if (abortRef.current === controller) abortRef.current = null;
        inFlightRef.current = null;
      }
    })();

    inFlightRef.current = promise;
    return promise;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let interval: number | null = null;

    const stopPolling = () => {
      if (interval !== null) {
        window.clearInterval(interval);
        interval = null;
      }
    };

    const startPolling = () => {
      if (document.hidden || interval !== null) return;
      interval = window.setInterval(() => {
        if (!document.hidden) void load();
      }, 15_000);
    };

    const onVisibility = () => {
      if (document.hidden) {
        stopPolling();
        return;
      }
      void load();
      startPolling();
    };

    const onFocus = () => {
      if (!document.hidden) void load();
    };

    /* the shared start flow fires this when the rig comes online — re-read at once
       so the offline hint clears without waiting for the 15s poll */
    const onComfyOnline = () => void load();

    void load();
    startPolling();
    window.addEventListener("focus", onFocus);
    window.addEventListener("comfy:online", onComfyOnline);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      mountedRef.current = false;
      stopPolling();
      abortRef.current?.abort();
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("comfy:online", onComfyOnline);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  const refresh = useCallback(() => {
    void load();
  }, [load]);

  return { ...status, loading, refresh };
}

function normalizeStatus(value: unknown): ComfyModelStatus {
  if (!isRecord(value)) return EMPTY_STATUS;
  const rawPresets = isRecord(value.presets) ? value.presets : {};
  const presets: Record<string, PresetAvailability> = {};

  for (const [preset, raw] of Object.entries(rawPresets)) {
    if (!isRecord(raw)) continue;
    presets[preset] = {
      available: raw.available === true,
      missing: Array.isArray(raw.missing)
        ? raw.missing.filter((item): item is string => typeof item === "string")
        : [],
      missingNodes: Array.isArray(raw.missingNodes)
        ? raw.missingNodes.filter((item): item is string => typeof item === "string")
        : [],
    };
  }

  return { online: value.online === true, presets };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
