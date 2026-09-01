/**
 * Smoke tests for the loop's beforeToolCall integration, system-prompt
 * plumbing (deck-assembled `system_prompt` vs bootstrap fallback), and
 * wire → pi-agent-core message conversion (tool-history replay).
 *
 * Drives the approval and pause flows directly without a real LLM by
 * constructing the hook in isolation and feeding it a fake
 * `BeforeToolCallContext`. The system-prompt round-trip test drives the
 * full runner with an injected Agent factory stub.
 *
 * Run with: `tsx --test src/server/loop.test.ts`
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ApprovalBroker } from "./broker.js";
import { EventBus } from "./event-bus.js";
import type { RunHandle } from "./runs.js";
import type { AGUIEvent, ChatMessageWire } from "../wire.js";
import { WorkspaceJail } from "../tools/jail.js";

// Re-export the internals we want to test by importing the module surface.
// makeBeforeToolCall + waitWhilePaused are private to loop.ts; we exercise
// them indirectly via the same patterns the loop uses.
import { Agent, type AgentOptions, type BeforeToolCallContext } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, Message, ToolResultMessage } from "@mariozechner/pi-ai";

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
    resolveSystemPrompt: (
      deckPrompt: string | undefined,
      jail: WorkspaceJail,
    ) => Promise<string>;
    wireToPiMessages: (
      wire: ChatMessageWire[] | undefined,
      legacyQuery: string | undefined,
      model: { api: string; provider: string; id: string },
    ) => Message[];
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

test("preflight: approval_required for a bridge tool defers to bridgeDispatch", async () => {
  // The deck's gateToolCall (lib/approvals/gate.ts) is the canonical
  // approval gate for bridge-routed tools — it persists the request in
  // SQLite and surfaces it in the deck's approval queue UI. agent-ts must
  // NOT also pause on its in-memory broker, otherwise the same tool call
  // would need two independent decisions on two separate UIs.
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
      bridgeToolNames: new Set(["vector_store"]),
    });

    const events: AGUIEvent[] = [];
    bus.subscribe(handle.runId, 0, (ev) => events.push(ev), () => {});

    // Should resolve undefined immediately — no broker pause, the bridge
    // call itself will block on the deck's persistent gate.
    const result = await before(fakeCtx("vector_store"));
    assert.equal(result, undefined);
    const interruptCount = events.filter((e) => e.type === "InterruptRequested").length;
    assert.equal(interruptCount, 0, "broker must not double-gate the bridge tool");
  } finally {
    await server.stop();
  }
});

test("non-bridge tools still gate on the in-memory broker", async () => {
  // bash isn't routed via the bridge — agent-ts's broker is the only
  // approval gate and the persistence path doesn't apply.
  const broker = new ApprovalBroker();
  const bus = new EventBus();
  const handle = fakeHandle();

  const before = hooks.makeBeforeToolCall({
    broker,
    bus,
    handle,
    // No preflight URL — even if there were one, bash isn't in bridgeToolNames.
    bridgeToolNames: new Set(["execute_code"]),
  });

  const events: AGUIEvent[] = [];
  bus.subscribe(handle.runId, 0, (ev) => events.push(ev), () => {});

  const hookPromise = before(fakeCtx("bash"));
  await new Promise((r) => setTimeout(r, 50));
  const requested = events.find((e) => e.type === "InterruptRequested");
  assert.ok(requested, "non-bridge bash should pause on the broker");
  const requestId = (requested.data as { approvalId: string }).approvalId;
  broker.approve(requestId);
  const out = await hookPromise;
  assert.equal(out, undefined);
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

test("system_prompt round-trip: Agent is constructed with the exact deck prompt", async () => {
  // The plan's required eval case: a run request carrying `system_prompt`
  // must land verbatim on pi-agent-core's initialState.systemPrompt —
  // canon is "Next assembles, agent-ts obeys". A SOUL.md marker in the
  // workspace proves the bootstrap stack is NOT appended on top (that
  // would double-inject memory the deck already assembled).
  const bus = new EventBus();
  const broker = new ApprovalBroker();
  const captured: AgentOptions[] = [];
  const runner = loop.makeLoopRunner({
    bus,
    broker,
    createAgent: (options: AgentOptions) => {
      captured.push(options);
      return {
        subscribe: () => () => {},
        continue: () => Promise.resolve(),
      };
    },
  });

  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-ts-loop-"));
  await fs.writeFile(path.join(workspace, "SOUL.md"), "BOOTSTRAP-MARKER must not appear");

  const sentPrompt = "DECK-ASSEMBLED :: memory + skill index + persona + voice";
  const handle = fakeHandle();
  await runner(
    handle,
    {
      messages: [{ role: "user", content: "hi" }],
      system_prompt: sentPrompt,
      workspace_root: workspace,
      // No `llm` field: the legacy standalone path tolerates an unanswered
      // /models probe (default endpoint is unroutable in tests), and the
      // stubbed agent never calls the LLM.
    },
    handle.controller.signal,
  );

  assert.equal(captured.length, 1, "exactly one Agent should be constructed");
  assert.equal(
    captured[0].initialState?.systemPrompt,
    sentPrompt,
    "system prompt must round-trip verbatim — no trimming, no bootstrap append",
  );
  assert.equal(bus.getStatus(handle.runId), "completed");
});

test("absent system_prompt: bootstrap stack remains the standalone-dev fallback", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-ts-loop-"));
  await fs.writeFile(path.join(workspace, "SOUL.md"), "You are TEST-PERSONA.");
  const jail = new WorkspaceJail(workspace);

  const prompt = await hooks.resolveSystemPrompt(undefined, jail);
  assert.ok(prompt.includes("TEST-PERSONA"), "bootstrap files still load when deck is absent");
  assert.ok(
    prompt.includes("Control Deck cockpit"),
    "local SYSTEM_PROMPT anchors the fallback stack",
  );

  // Blank but PRESENT means a deck is in front and assembled nothing
  // (persona off, memory disabled): keep the local base prompt, but never
  // read the bootstrap files — that would inject the MEMORY.md/SOUL.md the
  // deck's settings just turned off.
  const blank = await hooks.resolveSystemPrompt("   \n  ", jail);
  assert.ok(blank.includes("Control Deck cockpit"), "base prompt still anchors a blank deck prompt");
  assert.ok(!blank.includes("TEST-PERSONA"), "bootstrap must not leak in under a deck");

  // Present → verbatim, bootstrap untouched.
  const sent = "exact prompt\nwith newlines  and  spacing ";
  assert.equal(await hooks.resolveSystemPrompt(sent, jail), sent);
});

test("wire history replays assistant tool calls and tool results (T17)", () => {
  const model = { api: "openai-completions", provider: "openai", id: "m" };
  const wire: ChatMessageWire[] = [
    { role: "user", content: "what's on disk?" },
    {
      role: "assistant",
      content: "Let me check.",
      tool_calls: [{ id: "call-1", name: "bash", arguments: "{\"command\":\"ls\"}" }],
    },
    { role: "tool", tool_call_id: "call-1", name: "bash", content: "file.txt" },
    { role: "assistant", content: "There is file.txt" },
    {
      role: "tool-result",
      tool_call_id: "call-2",
      name: "read_file",
      content: "boom",
      is_error: true,
    },
  ];
  const out = hooks.wireToPiMessages(wire, undefined, model);

  // Nothing dropped: 5 wire messages in → 5 pi messages out.
  assert.equal(out.length, wire.length);
  assert.equal(out[0].role, "user");

  const toolCalling = out[1] as AssistantMessage;
  assert.equal(toolCalling.role, "assistant");
  assert.deepEqual(
    toolCalling.content.map((c) => c.type),
    ["text", "toolCall"],
    "assistant turn carries both its text and its tool call",
  );
  const call = toolCalling.content[1];
  assert.equal(call.type, "toolCall");
  if (call.type === "toolCall") {
    assert.equal(call.id, "call-1");
    assert.equal(call.name, "bash");
    assert.deepEqual(call.arguments, { command: "ls" }, "JSON-string args are parsed");
  }
  assert.equal(toolCalling.stopReason, "toolUse");

  const result = out[2] as ToolResultMessage;
  assert.equal(result.role, "toolResult");
  assert.equal(result.toolCallId, "call-1");
  assert.equal(result.toolName, "bash");
  assert.equal(result.isError, false);
  assert.deepEqual(result.content, [{ type: "text", text: "file.txt" }]);

  const plain = out[3] as AssistantMessage;
  assert.equal(plain.stopReason, "stop");

  // "tool-result" alias + error flag survive the conversion.
  const errResult = out[4] as ToolResultMessage;
  assert.equal(errResult.role, "toolResult");
  assert.equal(errResult.toolCallId, "call-2");
  assert.equal(errResult.isError, true);
});

test("wire history: system role messages are not replayed as chat messages", () => {
  // The system prompt now travels via req.system_prompt; a stray
  // role:"system" entry in history must not become a user/assistant turn.
  const model = { api: "openai-completions", provider: "openai", id: "m" };
  const out = hooks.wireToPiMessages(
    [
      { role: "system", content: "legacy injected prompt" },
      { role: "user", content: "hi" },
    ],
    undefined,
    model,
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].role, "user");
});

/* ------------------------------------------------------------------------ */
/* Deck-resolved `llm` config: verbatim use + availability check only        */
/* ------------------------------------------------------------------------ */

interface MockModelsServer {
  baseUrl: string;
  hits: number;
  lastAuth: string | undefined;
  stop: () => Promise<void>;
}

/** OpenAI-compatible /models endpoint serving exactly the given ids. */
async function startMockModels(models: string[]): Promise<MockModelsServer> {
  const { createServer } = await import("node:http");
  const state: MockModelsServer = {
    baseUrl: "",
    hits: 0,
    lastAuth: undefined,
    stop: () => Promise.resolve(),
  };
  const server = createServer((req, res) => {
    if (req.url?.endsWith("/models")) {
      state.hits += 1;
      state.lastAuth = req.headers.authorization;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: models.map((id) => ({ id })) }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("mock server failed to bind");
  }
  state.baseUrl = `http://127.0.0.1:${addr.port}/v1`;
  state.stop = () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  return state;
}

function captureRunner(bus: EventBus, broker: ApprovalBroker, captured: AgentOptions[]) {
  return loop.makeLoopRunner({
    bus,
    broker,
    createAgent: (options: AgentOptions) => {
      captured.push(options);
      return {
        subscribe: () => () => {},
        continue: () => Promise.resolve(),
      };
    },
  });
}

test("llm config: deck-resolved config lands verbatim on the pi model (no presets)", async () => {
  const bus = new EventBus();
  const broker = new ApprovalBroker();
  const captured: AgentOptions[] = [];
  const runner = captureRunner(bus, broker, captured);

  const mock = await startMockModels(["qwen3:8b"]);
  try {
    const handle = fakeHandle();
    const events: AGUIEvent[] = [];
    bus.subscribe(handle.runId, 0, (ev) => events.push(ev), () => {});

    // "ollama" exists in the legacy preset table with a DIFFERENT default
    // base_url — if presets were consulted, baseUrl would be rewritten to
    // localhost:11434. Asserting the custom base proves they weren't.
    await runner(
      handle,
      {
        messages: [{ role: "user", content: "hi" }],
        llm: { provider: "ollama", model: "qwen3:8b", base_url: mock.baseUrl, api_key: null },
      },
      handle.controller.signal,
    );

    assert.equal(captured.length, 1, "exactly one Agent should be constructed");
    const model = captured[0].initialState?.model;
    assert.equal(model?.id, "qwen3:8b");
    assert.equal(model?.name, "qwen3:8b");
    assert.equal(model?.baseUrl, mock.baseUrl, "base_url used verbatim — no preset rewrite");
    assert.equal(model?.provider, "ollama", "provider label round-trips");
    assert.equal(model?.api, "openai-completions");
    // api_key: null + localhost → dummy key so pi-ai's client doesn't throw.
    assert.equal(captured[0].getApiKey?.("ollama" as never), "local-no-auth");
    assert.equal(mock.hits, 1, "exactly one availability probe");
    assert.equal(mock.lastAuth, undefined, "no auth header without an api_key");
    const resolved = events.find((e) => e.type === "LLMResolved");
    assert.equal(resolved?.modelId, "qwen3:8b");
    assert.equal(bus.getStatus(handle.runId), "completed");

    // An explicit api_key flows verbatim into both the probe and the agent.
    const handle2 = fakeHandle();
    await runner(
      handle2,
      {
        messages: [{ role: "user", content: "hi" }],
        llm: { provider: "ollama", model: "qwen3:8b", base_url: mock.baseUrl, api_key: "sk-test" },
      },
      handle2.controller.signal,
    );
    assert.equal(captured.length, 2);
    assert.equal(captured[1].getApiKey?.("ollama" as never), "sk-test");
    assert.equal(mock.lastAuth, "Bearer sk-test", "probe authenticates with the deck key");
    assert.equal(bus.getStatus(handle2.runId), "completed");
  } finally {
    await mock.stop();
  }
});

test("llm config: unreachable endpoint fails the run with a structured error (no snap)", async () => {
  const bus = new EventBus();
  const broker = new ApprovalBroker();
  const captured: AgentOptions[] = [];
  const runner = captureRunner(bus, broker, captured);

  const handle = fakeHandle();
  const events: AGUIEvent[] = [];
  bus.subscribe(handle.runId, 0, (ev) => events.push(ev), () => {});

  await runner(
    handle,
    {
      messages: [{ role: "user", content: "hi" }],
      // Port 1 refuses connections → the availability probe can't reach it.
      llm: {
        provider: "ollama",
        model: "qwen3:8b",
        base_url: "http://127.0.0.1:1/v1",
        api_key: null,
      },
    },
    handle.controller.signal,
  );

  assert.equal(captured.length, 0, "agent must not be constructed when availability fails");
  assert.equal(bus.getStatus(handle.runId), "failed");
  const runError = events.find((e) => e.type === "RunError");
  assert.ok(runError, "RunError must be emitted");
  const payload = runError.error as {
    code?: string;
    model?: string;
    base_url?: string;
    served?: string[];
  };
  assert.equal(payload.code, "llm_unavailable");
  assert.equal(payload.model, "qwen3:8b", "error carries the requested id — no snap");
  assert.equal(payload.base_url, "http://127.0.0.1:1/v1");
  assert.ok(
    events.every((e) => e.type !== "LLMResolved"),
    "no resolution event when the endpoint is down",
  );
});

test("llm config: unserved model id fails the run — no silent snap to a served id", async () => {
  const bus = new EventBus();
  const broker = new ApprovalBroker();
  const captured: AgentOptions[] = [];
  const runner = captureRunner(bus, broker, captured);

  const mock = await startMockModels(["some-other-model"]);
  try {
    const handle = fakeHandle();
    const events: AGUIEvent[] = [];
    bus.subscribe(handle.runId, 0, (ev) => events.push(ev), () => {});

    await runner(
      handle,
      {
        messages: [{ role: "user", content: "hi" }],
        llm: { provider: "ollama", model: "qwen3:8b", base_url: mock.baseUrl, api_key: null },
      },
      handle.controller.signal,
    );

    assert.equal(captured.length, 0, "agent must not be constructed when the model isn't served");
    assert.equal(bus.getStatus(handle.runId), "failed");
    const runError = events.find((e) => e.type === "RunError");
    assert.ok(runError, "RunError must be emitted");
    const payload = runError.error as { code?: string; model?: string; served?: string[] };
    assert.equal(payload.code, "llm_model_unserved");
    assert.equal(payload.model, "qwen3:8b", "error reports the requested id, not a snapped one");
    assert.deepEqual(payload.served, ["some-other-model"]);
  } finally {
    await mock.stop();
  }
});

test("llm absent: legacy preset/env path still resolves and completes", async () => {
  const bus = new EventBus();
  const broker = new ApprovalBroker();
  const captured: AgentOptions[] = [];
  const runner = captureRunner(bus, broker, captured);

  // No `llm` field → standalone-dev path. The default endpoint is
  // unroutable in tests; legacy resolution tolerates an unanswered probe
  // and runs anyway (that tolerance is exactly what the deck path removed).
  const handle = fakeHandle();
  await runner(
    handle,
    { messages: [{ role: "user", content: "hi" }] },
    handle.controller.signal,
  );

  assert.equal(captured.length, 1, "legacy path still constructs the agent");
  const model = captured[0].initialState?.model;
  assert.equal(model?.api, "openai-completions");
  assert.ok(
    typeof model?.baseUrl === "string" && model.baseUrl.endsWith("/v1"),
    "legacy env/default endpoint shape preserved",
  );
  assert.equal(bus.getStatus(handle.runId), "completed");
});
