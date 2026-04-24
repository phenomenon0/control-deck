/**
 * Voice library helpers.
 *
 * Sits on top of lib/voice/store.ts and adds library-flavoured querying
 * (approved voices only, tag filters, "use in assistant" default toggle)
 * plus light provenance helpers. Keeps the store pure CRUD.
 */

import {
  getVoiceAsset,
  listVoiceAssets,
  updateVoiceAsset,
  type ListVoiceAssetsFilters,
} from "./store";
import type { VoiceAsset, VoiceAssetStatus } from "./types";

export interface LibraryFilters extends ListVoiceAssetsFilters {
  /** Restrict to "approved" + "restricted" by default; pass true to include drafts too. */
  includeDrafts?: boolean;
  tag?: string;
}

export function browseLibrary(filters: LibraryFilters = {}): VoiceAsset[] {
  const { includeDrafts, tag, ...rest } = filters;
  const statusFilter: VoiceAssetStatus[] = includeDrafts
    ? ["draft", "approved", "restricted"]
    : ["approved", "restricted"];

  const assets = listVoiceAssets(
    {
      ...rest,
      status: rest.status ?? statusFilter,
    },
    500,
  );
  if (!tag) return assets;
  const needle = tag.toLowerCase();
  return assets.filter((a) =>
    a.styleTags.some((t) => t.toLowerCase() === needle),
  );
}

export function publishVoiceAsset(id: string): VoiceAsset | undefined {
  return updateVoiceAsset(id, { status: "approved" });
}

export function archiveVoiceAsset(id: string): VoiceAsset | undefined {
  return updateVoiceAsset(id, { status: "archived" });
}

export function restrictVoiceAsset(id: string): VoiceAsset | undefined {
  return updateVoiceAsset(id, { status: "restricted" });
}

/** Shallow compatibility check — does this voice asset claim a given provider? */
export function voiceSupportsProvider(
  asset: VoiceAsset,
  providerId: string,
): boolean {
  if (asset.providerId === providerId) return true;
  // ElevenLabs-cloned assets remain compatible with ElevenLabs TTS in general,
  // even when an engine variant like "elevenlabs-pvc" is recorded.
  if (
    asset.engineId?.startsWith(providerId) ||
    providerId.startsWith(asset.providerId ?? "__none__")
  ) {
    return true;
  }
  return false;
}

export function getVoiceAssetForAssistant(
  id: string,
): VoiceAsset | undefined {
  const asset = getVoiceAsset(id);
  if (!asset) return undefined;
  if (asset.status === "archived") return undefined;
  return asset;
}
