"use client";

/**
 * Bridges client-observable realtime events into Voice Lab timing rows.
 *
 * s2s does not emit voice-core `?debug=timing` frames. The realtime path can
 * still observe the critical turn junctions in the browser: speech stopped,
 * transcript final, response created, first audio, and response done.
 */

import { useEffect, useRef } from "react";

import { useOptionalAudioDock } from "@/components/audio/AudioDockProvider";
import {
  createProbe,
  installProbe,
  JUNCTIONS,
  reportFromMarks,
  uninstallProbe,
  type Mark,
} from "@/lib/voice/test-harness/latency-probe";
import { useLabStore, type LabTimingEvent } from "@/lib/voice-lab/store";

export function useTimingFrames(): void {
  const dock = useOptionalAudioDock();
  const session = dock?.session ?? null;
  const { addRun, clearLive, knobs, pushEvent } = useLabStore();

  const knobsRef = useRef(knobs);
  const turnStartedAtRef = useRef<number>(Date.now());
  const turnMarksRef = useRef<Mark[]>([]);
  const turnEventsRef = useRef<LabTimingEvent[]>([]);

  useEffect(() => {
    knobsRef.current = knobs;
  }, [knobs]);

  useEffect(() => {
    const probe = createProbe({
      onMark(mark) {
        if (mark.name === JUNCTIONS.REALTIME_SPEECH_STARTED) {
          turnStartedAtRef.current = Date.now();
          turnMarksRef.current = [];
          turnEventsRef.current = [];
          clearLive();
        }

        const event: LabTimingEvent = {
          source: "client",
          name: mark.name,
          t: mark.t,
          meta: mark.meta,
        };
        turnMarksRef.current.push(mark);
        turnEventsRef.current.push(event);
        pushEvent(event);

        if (mark.name === JUNCTIONS.REALTIME_RESPONSE_DONE) {
          const report = reportFromMarks(turnMarksRef.current, {
            baseline: JUNCTIONS.REALTIME_SPEECH_STOPPED,
            startedAt: turnStartedAtRef.current,
          });
          addRun({
            id: `live-${Date.now()}`,
            startedAt: turnStartedAtRef.current,
            knobs: { ...knobsRef.current },
            source: "live",
            report,
            events: [...turnEventsRef.current],
          });
        }
      },
    });
    installProbe(probe);
    return () => {
      uninstallProbe();
    };
  }, [addRun, clearLive, pushEvent]);

  useEffect(() => {
    if (!session) return;
    const unsubscribe = session.subscribeTiming((frame) => {
      const event: LabTimingEvent = {
        source: frame.source,
        name: `srv_${frame.phase}`,
        t: frame.receivedAt,
        meta: { ms: frame.ms, ...frame.meta },
      };
      turnEventsRef.current.push(event);
      pushEvent(event);
    });
    return unsubscribe;
  }, [session, pushEvent]);
}
