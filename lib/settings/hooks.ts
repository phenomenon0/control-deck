"use client";

/**
 * Client-side hooks for server-persisted settings.
 *
 * `useSettings()` fetches the full tree once and keeps it in state, optimistic
 * on save. `useSettingsSection(section)` scopes to one section for cleaner
 * consumer code. Both hit `/api/settings`.
 */

import { useCallback, useEffect, useState } from "react";
import type { DeckSettings, SectionName } from "./schema";
import { DEFAULT_SETTINGS } from "./defaults";

interface UseSettingsResult {
  settings: DeckSettings;
  loading: boolean;
  error: string | null;
  /** Optimistically update one section; PUTs to /api/settings. */
  updateSection: <S extends SectionName>(
    section: S,
    value: Partial<DeckSettings[S]>,
  ) => Promise<void>;
  /** Re-fetch from server. */
  refetch: () => Promise<void>;
}

export function useSettings(): UseSettingsResult {
  const [settings, setSettings] = useState<DeckSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      if (!res.ok) throw new Error(`settings fetch ${res.status}`);
      const data = (await res.json()) as DeckSettings;
      setSettings(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "fetch failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const updateSection = useCallback(
    async <S extends SectionName>(section: S, value: Partial<DeckSettings[S]>) => {
      setSettings((prev) => ({
        ...prev,
        [section]: { ...prev[section], ...value } as DeckSettings[S],
      }));
      try {
        const res = await fetch("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ section, value }),
        });
        if (!res.ok) throw new Error(`settings PUT ${res.status}`);
        const next = (await res.json()) as DeckSettings;
        setSettings(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : "save failed");
        await fetchAll();
      }
    },
    [fetchAll],
  );

  return { settings, loading, error, updateSection, refetch: fetchAll };
}

export function useSettingsSection<S extends SectionName>(section: S) {
  const all = useSettings();
  const update = useCallback(
    (value: Partial<DeckSettings[S]>) => all.updateSection(section, value),
    [all, section],
  );
  return {
    value: all.settings[section],
    loading: all.loading,
    error: all.error,
    update,
    refetch: all.refetch,
  };
}
