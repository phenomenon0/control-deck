"use client";

/**
 * Shared workspace state for the Audio surface.
 *
 * Backed by URL search params so links deep-link into any pane and keep the
 * active asset / job highlight in sync across reloads. Cross-pane nav helpers
 * (`jumpToStudio`, `jumpToVoices`, `jumpToLive`, `jumpToHealth`) set the right
 * params in one call so a button in one pane can deep-link into another.
 *
 * Back-compat: old `?tab=assistant` / `?tab=voice` → conductor,
 * old `?tab=library` → voices. Callers can still use jumpToAssistant/jumpToLibrary
 * aliases so embedding code that hasn't migrated keeps working.
 */

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type VoiceTab =
  | "conductor"
  | "live"
  | "newsroom"
  | "voices"
  | "studio"
  | "health"
  | "stage"
  | "tape"
  | "forum";

const TAB_IDS: ReadonlySet<string> = new Set([
  "conductor",
  "live",
  "newsroom",
  "voices",
  "studio",
  "health",
  "stage",
  "tape",
  "forum",
]);

function normalizeTab(raw: string | null): VoiceTab {
  if (raw === "assistant" || raw === "voice") return "conductor";
  if (raw === "library") return "voices";
  if (raw && TAB_IDS.has(raw)) return raw as VoiceTab;
  return "conductor";
}

export interface VoiceWorkspace {
  tab: VoiceTab;
  assetId: string;
  jobId: string;
  setTab: (tab: VoiceTab) => void;
  setAssetId: (id: string) => void;
  setJobId: (id: string) => void;
  jumpToConductor: (opts?: { assetId?: string }) => void;
  jumpToNewsroom: () => void;
  jumpToVoices: (opts?: { assetId?: string }) => void;
  jumpToStudio: (opts?: { assetId?: string; jobId?: string }) => void;
  jumpToHealth: () => void;
  jumpToStage: () => void;
  jumpToTape: () => void;
  jumpToForum: () => void;
  /** Voice + chat surface. */
  jumpToLive: (opts?: { assetId?: string }) => void;
  /** @deprecated use jumpToConductor */
  jumpToAssistant: (opts?: { assetId?: string }) => void;
  /** @deprecated use jumpToVoices */
  jumpToLibrary: (opts?: { assetId?: string }) => void;
}

export function useVoiceWorkspace(): VoiceWorkspace {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const tab = normalizeTab(params.get("tab"));
  const assetId = params.get("asset") ?? "";
  const jobId = params.get("job") ?? "";

  const replace = useCallback(
    (next: Record<string, string | null>) => {
      const sp = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(next)) {
        if (value === null || value === "") sp.delete(key);
        else sp.set(key, value);
      }
      // `conductor` is the default; drop it from the URL for clean deep-links.
      if (sp.get("tab") === "conductor") sp.delete("tab");
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, router, pathname],
  );

  return useMemo<VoiceWorkspace>(() => {
    const jumpToConductor = (opts?: { assetId?: string }) =>
      replace({ tab: "conductor", asset: opts?.assetId ?? null, job: null });
    const jumpToLive = (opts?: { assetId?: string }) =>
      replace({ tab: "live", asset: opts?.assetId ?? assetId ?? null, job: null });
    const jumpToVoices = (opts?: { assetId?: string }) =>
      replace({ tab: "voices", asset: opts?.assetId ?? assetId ?? null, job: null });
    return {
      tab,
      assetId,
      jobId,
      setTab: (next) => replace({ tab: next }),
      setAssetId: (id) => replace({ asset: id }),
      setJobId: (id) => replace({ job: id }),
      jumpToConductor,
      jumpToNewsroom: () => replace({ tab: "newsroom", asset: null, job: null }),
      jumpToVoices,
      jumpToStudio: (opts) =>
        replace({
          tab: "studio",
          asset: opts?.assetId ?? assetId ?? null,
          job: opts?.jobId ?? null,
        }),
      jumpToHealth: () => replace({ tab: "health", asset: null, job: null }),
      jumpToStage: () => replace({ tab: "stage", asset: null, job: null }),
      jumpToTape: () => replace({ tab: "tape", asset: null, job: null }),
      jumpToForum: () => replace({ tab: "forum", asset: null, job: null }),
      jumpToLive,
      jumpToAssistant: jumpToConductor,
      jumpToLibrary: jumpToVoices,
    };
  }, [tab, assetId, jobId, replace]);
}
