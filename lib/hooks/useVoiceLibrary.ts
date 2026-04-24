"use client";

/**
 * Shared voice-library fetcher.
 *
 * Three panes (Library / Studio / Assistant) all need the voice asset list
 * and/or a single asset detail. This hook consolidates those fetches so we
 * don't maintain three copies of loading/error/filter state, and so the
 * filter -> refresh wiring is one implementation.
 *
 * Consumers:
 *   - LibraryPane: list + detail + filters
 *   - StudioPane: list (drafts) + detail, no filters
 *   - AssistantSurface: detail only
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ─── Shapes mirroring /api/voice/library responses ────────────────────────

export interface VoiceAssetSummary {
  id: string;
  name: string;
  status: string;
  providerId: string | null;
  engineId: string | null;
  language: string | null;
  styleTags: string[];
  description: string | null;
}

export interface VoiceAssetDetail {
  asset: VoiceAssetSummary & {
    accent: string | null;
    gender: string | null;
    owner: string | null;
    consentStatus: string;
    rightsStatus: string;
  };
  references: Array<{
    id: string;
    speakerName: string | null;
    transcript: string | null;
    artifact: { id?: string; url: string; name: string } | null;
  }>;
  previews: Array<{
    id: string;
    promptText: string;
    ratingSimilarity: number | null;
    ratingQuality: number | null;
    ratingLatency: number | null;
    artifact: { id: string; name: string; mimeType: string; url: string; createdAt: string } | null;
  }>;
}

export interface VoiceLibraryFilters {
  includeDrafts?: boolean;
  search?: string;
  status?: string;
  language?: string;
  tag?: string;
  providerId?: string;
}

export interface UseVoiceLibraryOptions extends VoiceLibraryFilters {
  /** Asset to fetch detail for. Pass empty string / null to skip detail. */
  assetId?: string | null;
  /** Skip the list fetch entirely — useful for AssistantSurface. */
  listDisabled?: boolean;
}

export interface VoiceLibraryState {
  assets: VoiceAssetSummary[];
  detail: VoiceAssetDetail | null;
  loading: boolean;
  error: string | null;
  refreshAssets: () => Promise<void>;
  refreshDetail: () => Promise<void>;
}

function buildListQuery(f: VoiceLibraryFilters): string {
  const qs = new URLSearchParams();
  if (f.includeDrafts) qs.set("includeDrafts", "true");
  if (f.search) qs.set("search", f.search);
  if (f.status) qs.set("status", f.status);
  if (f.language) qs.set("language", f.language);
  if (f.tag) qs.set("tag", f.tag);
  if (f.providerId) qs.set("providerId", f.providerId);
  return qs.toString();
}

export function useVoiceLibrary(options: UseVoiceLibraryOptions = {}): VoiceLibraryState {
  const {
    assetId,
    listDisabled,
    includeDrafts,
    search,
    status,
    language,
    tag,
    providerId,
  } = options;

  const [assets, setAssets] = useState<VoiceAssetSummary[]>([]);
  const [detail, setDetail] = useState<VoiceAssetDetail | null>(null);
  const [loading, setLoading] = useState(!listDisabled);
  const [error, setError] = useState<string | null>(null);

  // Hold the latest requested asset id so a stale fetch can drop its result.
  const detailRequestRef = useRef(0);

  const refreshAssets = useCallback(async () => {
    if (listDisabled) return;
    setLoading(true);
    setError(null);
    try {
      const qs = buildListQuery({ includeDrafts, search, status, language, tag, providerId });
      const url = qs ? `/api/voice/library?${qs}` : "/api/voice/library";
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load library");
      setAssets((data.assets as VoiceAssetSummary[]) ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [listDisabled, includeDrafts, search, status, language, tag, providerId]);

  const refreshDetail = useCallback(async () => {
    const id = assetId ?? "";
    if (!id) {
      setDetail(null);
      return;
    }
    const requestId = ++detailRequestRef.current;
    try {
      const res = await fetch(`/api/voice/library/${id}`);
      const data = await res.json();
      if (requestId !== detailRequestRef.current) return; // stale
      if (!res.ok) throw new Error(data.error || "Failed to load voice detail");
      setDetail(data as VoiceAssetDetail);
    } catch (err) {
      if (requestId !== detailRequestRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [assetId]);

  useEffect(() => {
    void refreshAssets();
  }, [refreshAssets]);

  useEffect(() => {
    void refreshDetail();
  }, [refreshDetail]);

  return useMemo(
    () => ({ assets, detail, loading, error, refreshAssets, refreshDetail }),
    [assets, detail, loading, error, refreshAssets, refreshDetail],
  );
}
