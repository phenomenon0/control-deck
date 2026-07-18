/**
 * Event conformance (T3/T7 tie-in) — the deck is the one run ledger, so the
 * events agent-ts emits on its SSE stream must be ingestible by the deck's
 * canonical AG-UI layer. This drives a scripted fake-LLM run through the
 * real loop runner (pi-agent-core Agent stubbed) and asserts every emitted
 * event:
 *
 *   1. passes the deck's `normalizeEvent` (lib/agui/events.ts) without
 *      throwing — the exact function the deck applies to persisted events;
 *   2. has a `type` present in the deck's `AGUIEvent` union;
 *   3. carries the base fields the deck ledger keys on: runId, threadId,
 *      timestamp — plus the per-type fields the deck union requires.
 *
 * Note on envelopes: agent-ts's wire carries `{ format, data }` payload
 * wrappers where the deck's internal events use DeckPayload (`{ kind, … }`).
 * The deck converts at its ingest boundary (mapAndPublishEvent in
 * app/api/chat/route.ts), so conformance here is asserted on event TYPE +
 * identity fields, which is the contract the SSE stream actually guarantees.
 *
 * Run with: `tsx --test src/server/conformance.test.ts`
 */

import test from "node:test";
import assert from "node:assert/strict";

import type { AgentEvent, AgentOptions } from "@mariozechner/pi-agent-core";
import type { Agent } from "@mariozechner/pi-agent-core";

import { ApprovalBroker } from "./broker.js";
import { EventBus } from "./event-bus.js";
import { makeLoopRunner } from "./loop.js";
import type { RunHandle } from "./runs.js";
import type { AGUIEvent } from "../wire.js";

// The deck's canonical AG-UI layer, imported from the repo root. The `@/*`
// path alias its transitive imports use is mapped in apps/agent-ts/tsconfig
// (`@/*` → repo root), which tsx honours.
import { normalizeEvent } from "../../../../lib/agui/events";
import type { AGUIEventType as DeckAGUIEventType } from "../../../../lib/agui/events";

/**
 * Runtime mirror of the deck's AGUIEvent union. `satisfies` makes tsc fail
 * here if a listed string ever leaves the union; the Set is the runtime
 * membership check for emitted events.
 */
const DECK_EVENT_TYPE_LIST = [
  "RunStarted",
  "RunFinished",
  "RunError",
  "TextMessageStart",
  "TextMessageContent",
  "TextMessageEnd",
  "ToolCallStart",
  "ToolCallArgs",
  "ToolCallResult",
  "ArtifactCreated",
  "CostIncurred",
  "InterruptRequested",
  "InterruptResolved",
  "StepStarted",
  "StepFinished",
  "LLMResolved",
  "WarningRaised",
] as const satisfies readonly DeckAGUIEventType[];
const DECK_EVENT_TYPES: ReadonlySet<string> = new Set(DECK_EVENT_TYPE_LIST);

function fakeHandle(): RunHandle {
  return {
    runId: "run-conformance-1",
    threadId: "thread-conformance-1",
    controller: new AbortController(),
    startedAt: new Date().toISOString(),
    status: "running",
  };
}

/** Minimal assistant-message shape — translate only reads role + timestamp. */
function assistantMessage(timestamp: number) {
  return {
    role: "assistant",
    content: [{ type: "text", text: "" }],
    api: "openai-completions",
    provider: "ollama",
    model: "m",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp,
  };
}

/**
 * The scripted agent turn: one text message, one tool call with an artifact
 * in its result details, then a follow-up text message. Exercises every
 * branch of loop.ts's translate() in one deterministic pass.
 */
function scriptedEvents(): AgentEvent[] {
  return [
    { type: "message_start", message: assistantMessage(1000) },
    {
      type: "message_update",
      message: assistantMessage(1000),
      assistantMessageEvent: { type: "text_delta", delta: "Hello" },
    },
    {
      type: "message_update",
      message: assistantMessage(1000),
      assistantMessageEvent: { type: "text_delta", delta: " world" },
    },
    { type: "message_end", message: assistantMessage(1000) },
    {
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: "read_file",
      args: { path: "/tmp/x" },
    },
    {
      type: "tool_execution_end",
      toolCallId: "call-1",
      toolName: "read_file",
      isError: false,
      result: {
        output: "file contents",
        details: {
          artifacts: [
            {
              id: "art-1",
              url: "http://deck.local/api/artifacts/art-1",
              name: "shot.png",
              mimeType: "image/png",
            },
          ],
        },
      },
    },
    { type: "message_start", message: assistantMessage(2000) },
    {
      type: "message_update",
      message: assistantMessage(2000),
      assistantMessageEvent: { type: "text_delta", delta: "Done." },
    },
    { type: "message_end", message: assistantMessage(2000) },
    // The scripted objects are intentionally minimal (translate reads a
    // handful of fields); the pi types want the full message surface.
  ] as unknown as AgentEvent[];
}

/** Per-type required fields from the deck's AGUIEvent union (spot-checked). */
function assertDeckRequiredFields(event: AGUIEvent) {
  switch (event.type) {
    case "TextMessageStart":
      assert.equal(typeof event.messageId, "string");
      assert.ok(
        event.role === "assistant" || event.role === "user" || event.role === "system",
        `TextMessageStart.role must be a deck role, got ${String(event.role)}`,
      );
      break;
    case "TextMessageContent":
      assert.equal(typeof event.messageId, "string");
      assert.equal(typeof event.delta, "string");
      break;
    case "TextMessageEnd":
      assert.equal(typeof event.messageId, "string");
      break;
    case "ToolCallStart":
      assert.equal(typeof event.toolCallId, "string");
      assert.equal(typeof event.toolName, "string");
      break;
    case "ToolCallResult":
      assert.equal(typeof event.toolCallId, "string");
      assert.ok(event.result !== undefined, "ToolCallResult.result is required");
      break;
    case "ArtifactCreated":
      assert.equal(typeof event.artifactId, "string");
      assert.equal(typeof event.url, "string");
      assert.equal(typeof event.name, "string");
      assert.equal(typeof event.mimeType, "string");
      break;
    case "LLMResolved":
      assert.equal(typeof event.provider, "string");
      assert.equal(typeof event.modelId, "string");
      break;
    case "RunError":
      assert.equal(typeof (event.error as { message?: unknown })?.message, "string");
      break;
    default:
      // RunStarted / RunFinished: no extra required fields beyond the base.
      break;
  }
}

/** The three assertions every emitted event must satisfy. */
function assertDeckConformant(event: AGUIEvent, handle: RunHandle) {
  assert.ok(
    DECK_EVENT_TYPES.has(event.type),
    `event type '${event.type}' is not in the deck's AGUIEvent union`,
  );
  assert.equal(event.runId, handle.runId, "runId must be the run's canonical id");
  assert.equal(event.threadId, handle.threadId, "threadId must be the run's thread id");
  assert.equal(typeof event.timestamp, "string");
  assert.ok(
    !Number.isNaN(Date.parse(event.timestamp)),
    `timestamp must be a parseable date, got ${String(event.timestamp)}`,
  );
  assertDeckRequiredFields(event);

  // normalizeEvent mutates its input — hand it a clone, like the deck hands
  // it rows freshly parsed out of SQLite.
  const clone = JSON.parse(JSON.stringify(event)) as Record<string, unknown>;
  assert.doesNotThrow(() => normalizeEvent(clone));
  const normalized = normalizeEvent(clone);
  assert.equal(normalized.type, event.type);
  assert.equal(normalized.runId, event.runId);
  assert.equal(normalized.threadId, event.threadId);
}

test("conformance: scripted fake-LLM run emits only deck-union events", async () => {
  const bus = new EventBus();
  const broker = new ApprovalBroker();
  const script = scriptedEvents();

  const runner = makeLoopRunner({
    bus,
    broker,
    createAgent: (_options: AgentOptions): Pick<Agent, "subscribe" | "continue"> => {
      let listener: ((event: AgentEvent, signal: AbortSignal) => void | Promise<void>) | undefined;
      return {
        subscribe: (cb: (event: AgentEvent, signal: AbortSignal) => void | Promise<void>) => {
          listener = cb;
          return () => {
            listener = undefined;
          };
        },
        continue: async () => {
          const signal = new AbortController().signal;
          for (const event of script) await listener?.(event, signal);
        },
      };
    },
  });

  const handle = fakeHandle();
  const events: AGUIEvent[] = [];
  bus.subscribe(handle.runId, 0, (ev) => events.push(ev), () => {});

  // No `llm` field: legacy resolution tolerates the unroutable default
  // endpoint and proceeds — same pattern as loop.test.ts — so no mock LLM
  // server is needed and LLMResolved is still exercised.
  await runner(
    handle,
    { messages: [{ role: "user", content: "hi" }] },
    handle.controller.signal,
  );

  assert.deepEqual(
    events.map((e) => e.type),
    [
      "RunStarted",
      "LLMResolved",
      "TextMessageStart",
      "TextMessageContent",
      "TextMessageContent",
      "TextMessageEnd",
      "ToolCallStart",
      "ToolCallResult",
      "ArtifactCreated",
      "TextMessageStart",
      "TextMessageContent",
      "TextMessageEnd",
      "RunFinished",
    ],
    "the scripted run must exercise every translate() branch in order",
  );

  for (const event of events) assertDeckConformant(event, handle);
  assert.equal(bus.getStatus(handle.runId), "completed");
});

test("conformance: LLM resolution failure emits a deck-conformant RunError", async () => {
  const bus = new EventBus();
  const broker = new ApprovalBroker();
  const runner = makeLoopRunner({ bus, broker });

  const handle = fakeHandle();
  const events: AGUIEvent[] = [];
  bus.subscribe(handle.runId, 0, (ev) => events.push(ev), () => {});

  await runner(
    handle,
    {
      messages: [{ role: "user", content: "hi" }],
      // Port 1 refuses connections — resolution fails before RunStarted.
      llm: {
        provider: "ollama",
        model: "qwen3:8b",
        base_url: "http://127.0.0.1:1/v1",
        api_key: null,
      },
    },
    handle.controller.signal,
  );

  assert.deepEqual(events.map((e) => e.type), ["RunError"]);
  for (const event of events) assertDeckConformant(event, handle);
  assert.equal(bus.getStatus(handle.runId), "failed");
});
