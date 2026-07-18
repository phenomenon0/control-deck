"use client";

/**
 * useChatCanvasAutoOpen — open run artifacts in the canvas as they appear.
 *
 * Extracted from ChatSurface.tsx (Phase 4 decomposition, SURFACE.md §5.1).
 * Restores the behavior lost in iteration 6 when useSSE was replaced by
 * useAgentRun: code-execution results and images created during a live run
 * auto-open in the canvas, once per artifact, resetting on thread switch.
 */

import { useEffect, useRef } from "react";
import { useCanvas } from "@/lib/hooks/useCanvas";
import type { ArtifactSegment, TimelineSegment } from "@/lib/types/agentRun";

interface UseChatCanvasAutoOpenOptions {
  segments: TimelineSegment[];
  isRunning: boolean;
  effectiveThreadId: string;
}

export function useChatCanvasAutoOpen({
  segments,
  isRunning,
  effectiveThreadId,
}: UseChatCanvasAutoOpenOptions): void {
  const canvas = useCanvas();
  const openedArtifactIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const artifactSegments = segments.filter(
      (s): s is ArtifactSegment => s.type === "artifact"
    );
    for (const seg of artifactSegments) {
      const artifactId = seg.artifact.id;
      if (openedArtifactIdsRef.current.has(artifactId)) continue;
      openedArtifactIdsRef.current.add(artifactId);

      // Only auto-open for code execution results and images during a live run
      if (!isRunning) continue;
      canvas.openArtifact({
        id: artifactId,
        url: seg.artifact.url,
        name: seg.artifact.name,
        mimeType: seg.artifact.mimeType,
      });
    }
  }, [segments, isRunning, canvas]);

  // Clear tracked artifact IDs when switching threads
  useEffect(() => {
    openedArtifactIdsRef.current.clear();
  }, [effectiveThreadId]);
}
