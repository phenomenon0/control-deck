/**
 * Smoke tests for the loop's beforeToolCall integration.
 *
 * Drives the approval and pause flows directly without a real LLM by
 * constructing the hook in isolation and feeding it a fake
 * `BeforeToolCallContext`.
 *
 * Run with: `tsx --test src/server/loop.test.ts`
 */

import test from "node:test";
import assert from "node:assert/strict";

import { ApprovalBroker } from "./broker.js";
import { EventBus } from "./event-bus.js";
import type { RunHandle } from "./runs.js";
import type { AGUIEvent } from "../wire.js";

// Re-export the internals we want to test by importing the module surface.
// makeBeforeToolCall + waitWhilePaused are private to loop.ts; we exercise
// them indirectly via the same patterns the loop uses.
import { Agent, type BeforeToolCallContext } from "@mariozechner/pi-agent-core";

void Agent; // keep import to fail fast if pi-agent-core API drifts

import * as loop from "./loop.js";

interface InternalLoop {
  __testHooks?: {
    makeBeforeToolCall: (a: {
      broker: ApprovalBroker;
      bus: EventBus;
      handle: RunHandle;
    }) => (
      ctx: BeforeToolCallContext,
      signal?: AbortSignal,
    ) => Promise<{ block: boolean; reason?: string } | undefined>;
    waitWhilePaused: (
      handle: RunHandle,
      bus: EventBus,
      signal?: AbortSignal,
    ) => Promise<"running" | "aborted">;
  };
}

const hooks = (loop as unknown as InternalLoop).__testHooks;
if (!hooks) {
  throw new Error("loop.ts must export __testHooks for tests");
}

function fakeHandle(): RunHandle {
  return {
    runId: "run-" + Math.random().toString(36).slice(2, 8),
    threadId: "thread-1",
    controller: new AbortController(),
    startedAt: new Date().toISOString(),
    status: "running",
  };
}

function fakeCtx(toolName: string): BeforeToolCallContext {
  return {
    assistantMessage: {} as never,
    toolCall: {
      type: "toolCall",
      id: "call-1",
      name: toolName,
      arguments: {},
    } as never,
    args: { command: "echo hi" },
    context: {} as never,
  };
}

test("approval gate: approve resolves before-hook", async () => {
  const broker = new ApprovalBroker();
  const bus = new EventBus();
  const handle = fakeHandle();
  const before = hooks.makeBeforeToolCall({ broker, bus, handle });

  const events: AGUIEvent[] = [];
  bus.subscribe(handle.runId, 0, (ev) => events.push(ev), () => {});

  const hookPromise = before(fakeCtx("bash"));

  // Wait for InterruptRequested to be emitted.
  await new Promise((r) => setTimeout(r, 50));
  const requested = events.find((e) => e.type === "InterruptRequested");
  assert.ok(requested, "InterruptRequested should be emitted");
  const requestId = (requested.data as { approvalId: string }).approvalId;

  assert.ok(broker.approve(requestId), "approve should succeed");

  const result = await hookPromise;
  assert.equal(result, undefined, "hook returns undefined when approved");

  const resolved = events.find((e) => e.type === "InterruptResolved");
  assert.ok(resolved, "InterruptResolved emitted");
  assert.equal((resolved.data as { decision: string }).decision, "approved");
});

test("approval gate: reject blocks the tool", async () => {
  const broker = new ApprovalBroker();
  const bus = new EventBus();
  const handle = fakeHandle();
  const before = hooks.makeBeforeToolCall({ broker, bus, handle });

  const events: AGUIEvent[] = [];
  bus.subscribe(handle.runId, 0, (ev) => events.push(ev), () => {});

  const hookPromise = before(fakeCtx("bash"));
  await new Promise((r) => setTimeout(r, 50));
  const requested = events.find((e) => e.type === "InterruptRequested");
  assert.ok(requested);
  const requestId = (requested.data as { approvalId: string }).approvalId;

  assert.ok(broker.reject(requestId, "user said no"));

  const result = await hookPromise;
  assert.deepEqual(result, { block: true, reason: "user said no" });

  const resolved = events.find((e) => e.type === "InterruptResolved");
  assert.equal((resolved!.data as { decision: string }).decision, "denied");
});

test("approval gate: passes through for non-side-effect tools", async () => {
  const broker = new ApprovalBroker();
  const bus = new EventBus();
  const handle = fakeHandle();
  const before = hooks.makeBeforeToolCall({ broker, bus, handle });

  const result = await before(fakeCtx("read_file"));
  assert.equal(result, undefined, "read_file should not require approval");
});

test("pause gate: blocks then resumes when status flips", async () => {
  const bus = new EventBus();
  const handle = fakeHandle();
  handle.status = "paused_requested";

  const start = Date.now();
  const waitPromise = hooks.waitWhilePaused(handle, bus);

  setTimeout(() => {
    handle.status = "running";
  }, 80);

  const outcome = await waitPromise;
  assert.equal(outcome, "running");
  assert.ok(Date.now() - start >= 60, "should have waited at least one poll tick");
  assert.equal(bus.getStatus(handle.runId), "running");
});

test("pause gate: aborts when signal fires", async () => {
  const bus = new EventBus();
  const handle = fakeHandle();
  handle.status = "paused_requested";
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 50);

  const outcome = await hooks.waitWhilePaused(handle, bus, ctrl.signal);
  assert.equal(outcome, "aborted");
});
