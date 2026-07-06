"use client";

/**
 * Bridges the shared voice session's timing surface into the lab store.
 *
 * Two streams merge onto one timeline:
 *   1. Client `__voiceProbe` marks — every `mark()` is captured by installing
 *      a Probe via `installProbe()` (replaces the no-op global). When the
 *      lab page mounts, every existing call site (`stt_partial_first`,
 *      `audio_started`, `vad_speech_end`, …) starts feeding into the probe.
 *   2. Server timing frames — fanned out from `session.subscribeTiming()`.
 *      Each `{phase, ms, meta}` becomes both a probe mark named `srv_<phase>`
 *      AND a row in the store's live-frame buffer.
 *
 * On unmount: the probe is uninstalled so the global goes back to undefined
 * and production paths regain the no-op fast path.
 */

import { useEffect } from "react";

import { useOptionalAudioDock } from "@/components/audio/AudioDockProvider";
import { createProbe, installProbe, uninstallProbe } from "@/lib/voice/test-harness/latency-probe";
import { useLabStore } from "@/lib/voice-lab/store";

/**
 * Mount once near the top of the lab page. Installs a probe at
 * `globalThis.__voiceProbe` so every existing `mark()` call site starts
 * feeding into the lab. Read via `globalThis.__voiceProbe?.report()` /
 * `globalThis.__voiceProbe?.marks()` from anywhere on the page.
 */
export function useTimingFrames(): void {
  const dock = useOptionalAudioDock();
  const session = dock?.session ?? null;
  const { pushFrame } = useLabStore();

  useEffect(() => {
    const probe = createProbe();
    installProbe(probe);
    return () => {
      uninstallProbe();
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    const unsubscribe = session.subscribeTiming((frame) => {
      pushFrame(frame);
    });
    return unsubscribe;
  }, [session, pushFrame]);
}
