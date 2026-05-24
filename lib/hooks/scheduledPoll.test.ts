import { describe, expect, it } from "bun:test";

import {
  createScheduledPoll,
  type ScheduledPollEnv,
} from "./scheduledPoll";

/**
 * Deterministic test rig — a tiny in-process scheduler that lets us advance
 * time in controlled chunks instead of relying on real setTimeout. Same
 * idea as jest.useFakeTimers but framework-agnostic.
 */
function makeRig(opts: { visible?: boolean } = {}) {
  type Pending = { at: number; fn: () => void; id: number };
  let nowMs = 0;
  let nextId = 1;
  const pending = new Map<number, Pending>();
  let visible = opts.visible ?? true;
  const visibilityListeners = new Set<(v: boolean) => void>();

  const env: ScheduledPollEnv = {
    now: () => nowMs,
    setTimer: (fn, ms) => {
      const id = nextId++;
      pending.set(id, { at: nowMs + ms, fn, id });
      return id;
    },
    clearTimer: (handle) => {
      pending.delete(handle as number);
    },
    getVisibility: () => visible,
    addVisibilityListener: (onChange) => {
      visibilityListeners.add(onChange);
      return () => visibilityListeners.delete(onChange);
    },
  };

  const advance = async (ms: number) => {
    const target = nowMs + ms;
    // Fire timers in ascending order until we exhaust everything due ≤ target.
    while (true) {
      const due = Array.from(pending.values())
        .filter((p) => p.at <= target)
        .sort((a, b) => a.at - b.at);
      if (due.length === 0) break;
      const next = due[0]!;
      pending.delete(next.id);
      nowMs = next.at;
      next.fn();
      // Yield so microtasks (promise resolutions inside the fn) settle
      // before we look at `pending` again — async tick() chains depend on
      // this for re-scheduling to register.
      await new Promise((r) => queueMicrotask(() => r(undefined)));
    }
    nowMs = target;
  };

  const setVisible = (v: boolean) => {
    visible = v;
    for (const listener of visibilityListeners) listener(v);
  };

  return {
    env,
    advance,
    setVisible,
    pendingCount: () => pending.size,
    now: () => nowMs,
  };
}

describe("createScheduledPoll", () => {
  it("runs the callback on start when runOnMount is true (default)", async () => {
    const calls: number[] = [];
    const rig = makeRig();
    const handle = createScheduledPoll(
      () => {
        calls.push(rig.now());
      },
      { intervalMs: 100 },
      rig.env,
    );
    handle.start();
    await rig.advance(0);
    expect(calls).toEqual([0]);
    handle.stop();
  });

  it("does not run on mount when runOnMount is false", async () => {
    const calls: number[] = [];
    const rig = makeRig();
    const handle = createScheduledPoll(
      () => {
        calls.push(rig.now());
      },
      { intervalMs: 100, runOnMount: false },
      rig.env,
    );
    handle.start();
    await rig.advance(50);
    expect(calls).toEqual([]);
    await rig.advance(50); // now at 100ms
    expect(calls).toEqual([100]);
    handle.stop();
  });

  it("re-runs every intervalMs while running", async () => {
    const calls: number[] = [];
    const rig = makeRig();
    const handle = createScheduledPoll(
      () => {
        calls.push(rig.now());
      },
      { intervalMs: 100 },
      rig.env,
    );
    handle.start();
    await rig.advance(0);
    await rig.advance(100);
    await rig.advance(100);
    await rig.advance(100);
    expect(calls).toEqual([0, 100, 200, 300]);
    handle.stop();
  });

  it("stop() prevents further ticks", async () => {
    const calls: number[] = [];
    const rig = makeRig();
    const handle = createScheduledPoll(
      () => {
        calls.push(rig.now());
      },
      { intervalMs: 100 },
      rig.env,
    );
    handle.start();
    await rig.advance(0);
    handle.stop();
    await rig.advance(1000);
    expect(calls).toEqual([0]);
    expect(rig.pendingCount()).toBe(0);
  });

  it("skips ticks while hidden, runs immediately when visible again", async () => {
    const calls: number[] = [];
    const rig = makeRig({ visible: false });
    const handle = createScheduledPoll(
      () => {
        calls.push(rig.now());
      },
      { intervalMs: 100 },
      rig.env,
    );
    handle.start();
    await rig.advance(500);
    // Hidden the whole time — at most the runOnMount tick was attempted and
    // it short-circuited because visibility was false. No call body ran.
    expect(calls).toEqual([]);

    rig.setVisible(true);
    // visibility listener fires a fresh tick synchronously
    await rig.advance(0);
    expect(calls).toEqual([500]);

    await rig.advance(100);
    expect(calls).toEqual([500, 600]);
    handle.stop();
  });

  it("disables the visibility gate when visibilityGate=false", async () => {
    const calls: number[] = [];
    const rig = makeRig({ visible: false });
    const handle = createScheduledPoll(
      () => {
        calls.push(rig.now());
      },
      { intervalMs: 100, visibilityGate: false },
      rig.env,
    );
    handle.start();
    await rig.advance(0);
    await rig.advance(100);
    expect(calls).toEqual([0, 100]);
    handle.stop();
  });

  it("coalesces ticks when the callback is still in flight", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const calls: number[] = [];
    const rig = makeRig();
    const resolveSlot: { fn: (() => void) | null } = { fn: null };

    const handle = createScheduledPoll(
      () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        calls.push(rig.now());
        return new Promise<void>((resolve) => {
          // Hold the call open until the test explicitly resolves it.
          resolveSlot.fn = () => {
            inFlight--;
            resolve();
          };
        });
      },
      { intervalMs: 100 },
      rig.env,
    );

    handle.start();
    await rig.advance(0); // first call starts; promise still pending
    // Advance well past several intervals while the first call is still open.
    await rig.advance(500);
    expect(inFlight).toBe(1);
    expect(maxInFlight).toBe(1); // never overlapped

    resolveSlot.fn?.();
    // Flush the pending microtask (the `.finally` that re-schedules) so the
    // next setTimer call lands in `pending` before we advance the clock.
    await new Promise((r) => queueMicrotask(() => r(undefined)));
    await rig.advance(100);
    expect(calls.length).toBeGreaterThan(1);
    handle.stop();
  });

  it("doubles delay on failure, caps at maxIntervalMs, resets on success", async () => {
    let shouldFail = true;
    const rig = makeRig();
    const handle = createScheduledPoll(
      () => {
        if (shouldFail) throw new Error("boom");
      },
      { intervalMs: 100, maxIntervalMs: 800 },
      rig.env,
    );
    handle.start();
    await rig.advance(0);
    expect(handle.currentDelayMs()).toBe(200);

    await rig.advance(200);
    expect(handle.currentDelayMs()).toBe(400);

    await rig.advance(400);
    expect(handle.currentDelayMs()).toBe(800);

    await rig.advance(800);
    // Should cap at 800, not 1600.
    expect(handle.currentDelayMs()).toBe(800);

    shouldFail = false;
    await rig.advance(800);
    expect(handle.currentDelayMs()).toBe(100);
    handle.stop();
  });

  it("kick() runs immediately and resets back-off", async () => {
    let shouldFail = true;
    const calls: number[] = [];
    const rig = makeRig();
    const handle = createScheduledPoll(
      () => {
        calls.push(rig.now());
        if (shouldFail) throw new Error("boom");
      },
      { intervalMs: 100, maxIntervalMs: 800 },
      rig.env,
    );
    handle.start();
    await rig.advance(0);
    expect(handle.currentDelayMs()).toBe(200);

    shouldFail = false;
    handle.kick();
    // kick should reset the running delay to base BEFORE the tick runs
    // (otherwise back-off would persist after the failing run).
    await rig.advance(0);
    expect(handle.currentDelayMs()).toBe(100);
    expect(calls.length).toBe(2);
    handle.stop();
  });

  it("isRunning reflects start/stop lifecycle", async () => {
    const rig = makeRig();
    const handle = createScheduledPoll(
      () => {},
      { intervalMs: 100 },
      rig.env,
    );
    expect(handle.isRunning()).toBe(false);
    handle.start();
    expect(handle.isRunning()).toBe(true);
    handle.stop();
    expect(handle.isRunning()).toBe(false);
  });

  it("start() is idempotent — calling twice does not double-schedule", async () => {
    const calls: number[] = [];
    const rig = makeRig();
    const handle = createScheduledPoll(
      () => {
        calls.push(rig.now());
      },
      { intervalMs: 100 },
      rig.env,
    );
    handle.start();
    handle.start();
    await rig.advance(0);
    await rig.advance(100);
    expect(calls).toEqual([0, 100]);
    handle.stop();
  });
});
