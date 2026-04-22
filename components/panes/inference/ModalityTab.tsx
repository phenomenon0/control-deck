"use client";

/**
 * ModalityTab — stacks the three per-modality sections:
 *   1. LeaderboardStrip    — top-3 from curated + live benchmarks
 *   2. ProviderCompareTable — every registered provider side-by-side
 *   3. MetricsStrip         — live invocations filtered to this modality
 *
 * Clicking "Details" on a provider row opens the ProviderInspector.
 */

import { useState } from "react";

import { LeaderboardStrip } from "./LeaderboardStrip";
import { ProviderCompareTable } from "./ProviderCompareTable";
import { MetricsStrip } from "./MetricsStrip";
import { ProviderInspector } from "./ProviderInspector";
import { MODALITY_LABELS } from "./modality-meta";

type ModalityId =
  | "text"
  | "vision"
  | "image-gen"
  | "audio-gen"
  | "tts"
  | "stt"
  | "embedding"
  | "rerank"
  | "3d-gen"
  | "video-gen";

export function ModalityTab({
  modality,
  refreshToken,
}: {
  modality: ModalityId;
  refreshToken: number;
}) {
  const [detailsProviderId, setDetailsProviderId] = useState<string | null>(null);

  return (
    <div className="inference-modality-view">
      <div className="inference-modality-heading">
        <h2>{MODALITY_LABELS[modality]}</h2>
      </div>

      <LeaderboardStrip modality={modality} />

      <ProviderCompareTable
        modality={modality}
        refreshToken={refreshToken}
        onDetails={setDetailsProviderId}
      />

      <MetricsStrip modality={modality} refreshToken={refreshToken} />

      <ProviderInspector
        modality={modality}
        providerId={detailsProviderId}
        onClose={() => setDetailsProviderId(null)}
      />
    </div>
  );
}
