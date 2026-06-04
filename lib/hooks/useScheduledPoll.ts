"use client";

/**
 * useScheduledPoll — one shared scheduler for the deck's many polling hooks.
 *
 * Before this existed, ~26 components rolled their own setInterval. None of
 * them gated on document.visibilityState, so a hidden cockpit window still
 * wired up dozens of timers per minute. Each also reinvented the in-flight
 * guard and the exponential back-off after a transient failure.
 *
 * Contract:
 *   - The callback runs immediately on mount (unless `runOnMount: false`).
 *   - Re-runs every `intervalMs` while the tab is visible AND `enabled !== false`.
 *   - Skipped when the tab is hidden; runs once immediately when the tab
 *     becomes visible again (caller catches up).
 *   - In-flight calls are coalesced — if a tick fires while the previous
 *     is still running, the second tick is dropped (not queued).
 *   - On rejected promises, back-off doubles up to `maxIntervalMs`; one
 *     successful run resets back to `intervalMs`.
 *
 * The actual scheduling machine lives in `createScheduledPoll` so it can
 * be unit-tested without React or jsdom. The React hook is the thin glue.
 */

import { useEffect, useMemo, useRef } from "react";
import { createScheduledPoll, type ScheduledPollHandle } from "./scheduledPoll";

export interface ScheduledPollOptions {
  /** Base interval between successful runs. */
  intervalMs: number;
  /** Cap on the back-off interval after errors. Defaults to `intervalMs * 8`. */
  maxIntervalMs?: number;
  /** Run once immediately on mount. Defaults to true. */
  runOnMount?: boolean;
  /** Pause everything when false; resumes on next true. Defaults to true. */
  enabled?: boolean;
  /**
   * Skip ticks when document.visibilityState !== 'visible'. Defaults to true.
   * Set false for callbacks that must run even when the tab is hidden
   * (e.g. a watchdog that pings the OS-level supervisor).
   */
  visibilityGate?: boolean;
}

export interface ScheduledPollControls {
  /** Run the callback right now (subject to in-flight coalescing) and reset the timer. */
  kick(): void;
}

/**
 * React wrapper around createScheduledPoll. The schedule restarts only when
 * the *control* options change (intervalMs, maxIntervalMs, enabled,
 * visibilityGate, runOnMount) — the callback identity does NOT restart it,
 * the latest closure is always picked up via a ref.
 */
export function useScheduledPoll(
  fn: () => void | Promise<void>,
  opts: ScheduledPollOptions,
): ScheduledPollControls {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const handleRef = useRef<ScheduledPollHandle | null>(null);

  useEffect(() => {
    if (!opts.enabled && opts.enabled !== undefined) return;

    const handle = createScheduledPoll(() => fnRef.current(), opts);
    handleRef.current = handle;
    handle.start();

    return () => {
      handle.stop();
      handleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.intervalMs, opts.maxIntervalMs, opts.enabled, opts.visibilityGate, opts.runOnMount]);

  return useMemo<ScheduledPollControls>(
    () => ({
      kick() {
        handleRef.current?.kick();
      },
    }),
    [],
  );
}
