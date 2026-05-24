/**
 * Pure scheduling machine for `useScheduledPoll`.
 *
 * Pulled out of the React hook so the in-flight guard, exponential back-off,
 * visibility gate, and start/stop lifecycle can be unit-tested in plain
 * node without a DOM renderer. The hook is the React glue; this is the brain.
 *
 * Callers inject the environment: `now`, `setTimer`, `clearTimer`,
 * `getVisibility`, `addVisibilityListener`. Production wiring uses
 * `Date.now`, `setTimeout`, `clearTimeout`, and `document.*`; tests inject
 * deterministic mocks (see scheduledPoll.test.ts).
 */

export interface ScheduledPollEnv {
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  /** Returns true if the host surface is currently visible. */
  getVisibility: () => boolean;
  /**
   * Subscribe to "host became visible" / "host became hidden" events. Return
   * an unsubscribe. Pass `null` if visibility gating isn't wired (the
   * scheduler will assume always visible).
   */
  addVisibilityListener:
    | ((onChange: (visible: boolean) => void) => () => void)
    | null;
}

export interface ScheduledPollConfig {
  intervalMs: number;
  maxIntervalMs?: number;
  runOnMount?: boolean;
  visibilityGate?: boolean;
}

export interface ScheduledPollHandle {
  start(): void;
  stop(): void;
  /** Run the callback now (respecting the in-flight guard) and reset back-off. */
  kick(): void;
  /** Diagnostics — current back-off delay in ms. */
  currentDelayMs(): number;
  /** Diagnostics — has start() been called and not yet stopped? */
  isRunning(): boolean;
}

const DEFAULT_ENV: ScheduledPollEnv = {
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  getVisibility: () => {
    if (typeof document === "undefined") return true;
    return document.visibilityState === "visible";
  },
  addVisibilityListener: (onChange) => {
    if (typeof document === "undefined") return () => {};
    const handler = () => onChange(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  },
};

export function createScheduledPoll(
  fn: () => void | Promise<void>,
  config: ScheduledPollConfig,
  env: ScheduledPollEnv = DEFAULT_ENV,
): ScheduledPollHandle {
  const baseInterval = Math.max(1, config.intervalMs);
  const ceiling = Math.max(baseInterval, config.maxIntervalMs ?? baseInterval * 8);
  const runOnMount = config.runOnMount !== false;
  const visibilityGate = config.visibilityGate !== false;

  let currentDelay = baseInterval;
  let timer: unknown = null;
  let inFlight = false;
  let started = false;
  let stopped = false;
  let unsubscribeVisibility: (() => void) | null = null;

  const isVisible = () => {
    if (!visibilityGate) return true;
    return env.getVisibility();
  };

  const clearPendingTimer = () => {
    if (timer !== null) {
      env.clearTimer(timer);
      timer = null;
    }
  };

  const schedule = (delay: number) => {
    if (stopped) return;
    clearPendingTimer();
    timer = env.setTimer(tick, delay);
  };

  const tick = async () => {
    if (stopped) return;
    timer = null;
    if (!isVisible()) {
      // Defer until the visibility listener wakes us. No re-schedule here —
      // the wake-up callback below will run a fresh tick.
      return;
    }
    if (inFlight) {
      schedule(currentDelay);
      return;
    }
    inFlight = true;
    try {
      await fn();
      currentDelay = baseInterval;
    } catch {
      currentDelay = Math.min(currentDelay * 2, ceiling);
    } finally {
      inFlight = false;
      schedule(currentDelay);
    }
  };

  return {
    start() {
      if (started || stopped) return;
      started = true;
      if (visibilityGate && env.addVisibilityListener) {
        unsubscribeVisibility = env.addVisibilityListener((visible) => {
          if (visible && !stopped) {
            void tick();
          }
        });
      }
      if (runOnMount) {
        void tick();
      } else {
        schedule(currentDelay);
      }
    },
    stop() {
      stopped = true;
      clearPendingTimer();
      if (unsubscribeVisibility) {
        unsubscribeVisibility();
        unsubscribeVisibility = null;
      }
    },
    kick() {
      if (stopped) return;
      currentDelay = baseInterval;
      void tick();
    },
    currentDelayMs() {
      return currentDelay;
    },
    isRunning() {
      return started && !stopped;
    },
  };
}
