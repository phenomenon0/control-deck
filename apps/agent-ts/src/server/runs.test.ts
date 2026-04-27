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
