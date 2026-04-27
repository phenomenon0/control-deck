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
      preflightUrl?: string;
      bridgeToolNames?: Set<string>;
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

interface MockPreflightServer {
  url: string;
  stop: () => Promise<void>;
}

async function startMockPreflight(
  handler: (body: Record<string, unknown>) => Record<string, unknown>,
): Promise<MockPreflightServer> {
  const { createServer } = await import("node:http");
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        // ignore
      }
      const reply = handler(body);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(reply));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("mock server failed to bind");
  }
  return {
    url: `http://127.0.0.1:${addr.port}/preflight`,
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
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

test("preflight: deny from deck blocks the tool without consulting the broker", async () => {
  const broker = new ApprovalBroker();
  const bus = new EventBus();
  const handle = fakeHandle();

  // Local mock preflight server — answers deny.
  const preflightCalls: Array<Record<string, unknown>> = [];
  const server = await startMockPreflight((body) => {
    preflightCalls.push(body);
    return { decision: "deny", reason: "policy says no", risk: "dangerous" };
  });

  try {
    const before = hooks.makeBeforeToolCall({
      broker,
      bus,
      handle,
      preflightUrl: server.url,
      bridgeToolNames: new Set(["execute_code"]),
    });

    const result = await before(fakeCtx("execute_code"));
    assert.deepEqual(result, { block: true, reason: "policy says no" });
    assert.equal(preflightCalls.length, 1);
    assert.equal((preflightCalls[0] as { tool: string }).tool, "execute_code");
  } finally {
    await server.stop();
  }
});

test("preflight: approval_required from deck pauses on the broker", async () => {
  const broker = new ApprovalBroker();
  const bus = new EventBus();
  const handle = fakeHandle();

  const server = await startMockPreflight(() => ({
    decision: "approval_required",
    reason: "risk=medium_write requires approval",
    risk: "medium_write",
  }));

  try {
    const before = hooks.makeBeforeToolCall({
      broker,
      bus,
      handle,
      preflightUrl: server.url,
      // Important: vector_store is not in the local agent-ts SIDE_EFFECT_TOOLS
      // table, so absent the deck signal it would pass through. The deck
      // forcing approval_required must still trigger the broker.
      bridgeToolNames: new Set(["vector_store"]),
    });

    const events: AGUIEvent[] = [];
    bus.subscribe(handle.runId, 0, (ev) => events.push(ev), () => {});

    const hookPromise = before(fakeCtx("vector_store"));
    await new Promise((r) => setTimeout(r, 50));
    const requested = events.find((e) => e.type === "InterruptRequested");
    assert.ok(requested, "InterruptRequested should be emitted via deck signal");
    const requestId = (requested.data as { approvalId: string }).approvalId;
    broker.approve(requestId);
    const out = await hookPromise;
    assert.equal(out, undefined);
  } finally {
    await server.stop();
  }
});

test("preflight: allow lets the tool through (no broker pause)", async () => {
  const broker = new ApprovalBroker();
  const bus = new EventBus();
  const handle = fakeHandle();

  const server = await startMockPreflight(() => ({
    decision: "allow",
    risk: "read_only",
  }));

  try {
    const before = hooks.makeBeforeToolCall({
      broker,
      bus,
      handle,
      preflightUrl: server.url,
      bridgeToolNames: new Set(["analyze_image"]),
    });
    const result = await before(fakeCtx("analyze_image"));
    assert.equal(result, undefined);
  } finally {
    await server.stop();
  }
});

test("preflight: skipped for non-bridge tools (native_*, skills)", async () => {
  const broker = new ApprovalBroker();
  const bus = new EventBus();
  const handle = fakeHandle();

  let called = 0;
  const server = await startMockPreflight(() => {
    called += 1;
    return { decision: "deny", reason: "should not have been called" };
  });

  try {
    const before = hooks.makeBeforeToolCall({
      broker,
      bus,
      handle,
      preflightUrl: server.url,
      bridgeToolNames: new Set(["execute_code"]),
    });

    // read_file is not in the bridge set, so preflight is bypassed
    // and the local approval table also lets it through.
    const result = await before(fakeCtx("read_file"));
    assert.equal(result, undefined);
    assert.equal(called, 0, "preflight must not be hit for non-bridge tools");
  } finally {
    await server.stop();
  }
});

test("preflight: network failure fails open (bridgeDispatch re-decides)", async () => {
  const broker = new ApprovalBroker();
  const bus = new EventBus();
  const handle = fakeHandle();

  const before = hooks.makeBeforeToolCall({
    broker,
    bus,
    handle,
    preflightUrl: "http://127.0.0.1:1/never-listening",
    bridgeToolNames: new Set(["analyze_image"]),
  });
  // Should resolve undefined (allow) rather than throw or block.
  const result = await before(fakeCtx("analyze_image"));
  assert.equal(result, undefined);
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
