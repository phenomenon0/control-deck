/**
 * RunManager tests — caller-allocated `run_id` plumbing.
 *
 * Covers the canonical-runId path: when the deck (Next) hands a runId in
 * the StartRunRequest body, agent-ts must use that same id rather than
 * allocating its own. Falls back to randomUUID() when absent or malformed.
 *
 * Run with: `tsx --test src/server/runs.test.ts`
 */

import test from "node:test";
import assert from "node:assert/strict";

import { RunManager } from "./runs.js";
import type { StartRunRequestWire } from "../wire.js";

function noopRunner() {
  return Promise.resolve();
}

test("RunManager.start honours caller-allocated run_id", () => {
  const runs = new RunManager(noopRunner);
  const req: StartRunRequestWire = {
    run_id: "deck-canonical-run-abc123",
    thread_id: "t-1",
    messages: [{ role: "user", content: "hi" }],
  };
  const { runId } = runs.start(req);
  assert.equal(runId, "deck-canonical-run-abc123");
});

test("RunManager.start generates a UUID when run_id is absent", () => {
  const runs = new RunManager(noopRunner);
  const req: StartRunRequestWire = {
    thread_id: "t-2",
    messages: [{ role: "user", content: "hi" }],
  };
  const { runId } = runs.start(req);
  assert.match(runId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test("RunManager.start rejects malformed run_id and falls back to UUID", () => {
  const runs = new RunManager(noopRunner);
  // Path-traversal flavoured nonsense — must not be accepted as the runId.
  const req: StartRunRequestWire = {
    run_id: "../../etc/passwd",
    thread_id: "t-3",
    messages: [{ role: "user", content: "hi" }],
  };
  const { runId } = runs.start(req);
  assert.notEqual(runId, "../../etc/passwd");
  assert.match(runId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

/* ------------------------------------------------------------------------ */
/* In-memory lifecycle: cancel / pause / resume                              */
/*                                                                            */
/* The manager is the ONLY run state agent-ts holds — a Map of live handles. */
/* Nothing is persisted; a finished/crashed run simply leaves the map.       */
/* ------------------------------------------------------------------------ */

test("RunManager.cancel aborts the live run; handle leaves the map on settle", async () => {
  let observedSignal: AbortSignal | undefined;
  const runs = new RunManager((_handle, _req, signal) => {
    observedSignal = signal;
    return new Promise<void>((resolve) => {
      signal.addEventListener("abort", () => resolve());
    });
  });
  const { runId } = runs.start({
    thread_id: "t-cancel",
    messages: [{ role: "user", content: "hi" }],
  });
  assert.equal(runs.size(), 1);

  // start() invokes the runner in a microtask — yield so it can capture the
  // signal and attach its abort listener before we cancel.
  await Promise.resolve();
  assert.equal(runs.cancel(runId), true);
  assert.equal(observedSignal?.aborted, true, "cancel must fire the AbortController");

  // The runner resolves on abort; the manager drops the handle once it settles.
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(runs.size(), 0);
  assert.equal(runs.cancel(runId), false, "cancelling a gone run is a miss");
});

test("RunManager.pause/resume flip the in-memory handle status", () => {
  // Runner that never settles, so the handle stays live for the assertions.
  const runs = new RunManager(() => new Promise<void>(() => {}));
  const { runId } = runs.start({
    thread_id: "t-pause",
    messages: [{ role: "user", content: "hi" }],
  });

  assert.equal(runs.pause(runId), true);
  assert.equal(runs.get(runId)?.status, "paused_requested");
  assert.equal(runs.resume(runId), true);
  assert.equal(runs.get(runId)?.status, "running");
  assert.equal(runs.pause("no-such-run"), false, "unknown runId is a miss");
});
