"use client";

/**
 * AssistantSurface — back-compat alias for `LiveVoiceSurface`.
 *
 * The Audio pane's "Live" tab used to be called "Assistant" and rendered this
 * component. Import path stability is preserved for existing callers (e.g.
 * AudioPane before the rename) by re-exporting the new surface here.
 */

export { LiveVoiceSurface as AssistantSurface } from "@/components/voice-live/LiveVoiceSurface";
