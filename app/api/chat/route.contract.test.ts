/**
 * Chat route contract tests — POST /api/chat ↔ agent-ts wire invariants.
 *
 * The route is a 900-line SSE proxy currently being decomposed; these tests
 * pin the PUBLIC HTTP contract that must survive that refactor:
 *
 *   (a) runId echo end-to-end — client-supplied runId reaches agent-ts as
 *       run_id and comes back on every streamed AG-UI event + X-Run-Id.
 *   (b) the first TextMessageStart from agent-ts is suppressed (the deck
 *       pre-emits its own), later ones are forwarded.
 *   (c) the SSE body parses with the canonical SSEParser (lib/agui/sse.ts)
 *       and preserves upstream event order.
 *   (d) the `llm` and `system_prompt` wire fields reach agent-ts verbatim
 *       (Phase-2 / Phase-1 contracts with pi-agent-core).
 *   (e) malformed bodies → 400, and agent-ts is never contacted.
 *
 * Setup: a real fake-agent-ts HTTP/SSE server (tests/fixtures/fake-agent-ts.ts)
 * on an OS-assigned port; the route is pointed at it via AGENT_TS_URL, which
 * lib/agentgo/launcher reads at module evaluation — so the env var is set
 * BEFORE the dynamic `await import("./route")` (bun evaluates one process;
 * no other test file imports the launcher chain). Persistence and the
 * model/prompt assembly layers are spied on the real module namespaces
 * (approvals-route pattern), never mock.module.
 */

import { afterAll, afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as actualDb from "@/lib/agui/db";
import * as actualResolve from "@/lib/engine/resolve";
import * as actualMemoryPrompt from "@/lib/memory/prompt";
import * as actualSkillIndex from "@/lib/skills/index-block";
import * as actualComfyRefs from "@/lib/comfy/refs";
import * as actualSystem from "@/lib/system";
import { augmentForModel } from "@/lib/llm/systemPrompt";
import { SSEParser } from "@/lib/agui/sse";
import type { AGUIEvent } from "@/lib/agui/events";
import { agt, startFakeAgentTs } from "@/tests/fixtures/fake-agent-ts";

// ── recorded calls ───────────────────────────────────────────────────

const dbState: {
  createdRuns: string[];
  finishedRuns: string[];
  errorCalls: Array<{ runId: string; error: string }>;
  savedEvents: number;
} = {
  createdRuns: [],
  finishedRuns: [],
  errorCalls: [],
  savedEvents: 0,
};

const dbSpies = {
  createThread: spyOn(actualDb, "createThread").mockImplementation((() => {}) as never),
  getThread: spyOn(actualDb, "getThread").mockImplementation((() => undefined) as never),
  createRun: spyOn(actualDb, "createRun").mockImplementation(((id: string) => {
    dbState.createdRuns.push(id);
  }) as never),
  saveEvent: spyOn(actualDb, "saveEvent").mockImplementation((() => {
    dbState.savedEvents += 1;
  }) as never),
  saveMessage: spyOn(actualDb, "saveMessage").mockImplementation((() => {}) as never),
  finishRun: spyOn(actualDb, "finishRun").mockImplementation(((id: string) => {
    dbState.finishedRuns.push(id);
  }) as never),
  errorRun: spyOn(actualDb, "errorRun").mockImplementation(((id: string, error: string) => {
    dbState.errorCalls.push({ runId: id, error });
  }) as never),
  updateRunPreview: spyOn(actualDb, "updateRunPreview").mockImplementation((() => {}) as never),
};

/** The one resolved model route every test run uses — asserted verbatim in (d). */
const FIXED_ROUTE = {
  provider: "test-provider",
  model: "test-model-9000",
  baseUrl: "http://llm-fixture.test/v1",
  apiKey: "fixture-key",
  source: "request" as const,
};

const resolveModelRouteSpy = spyOn(actualResolve, "resolveModelRoute").mockImplementation(
  (async () => FIXED_ROUTE) as never,
);
const renderMemorySpy = spyOn(actualMemoryPrompt, "renderMemoryForPrompt").mockImplementation(
  (() => "") as never,
);
const renderSkillIndexSpy = spyOn(actualSkillIndex, "renderSkillIndex").mockImplementation(
  (() => "") as never,
);
const renderWorkflowRefSpy = spyOn(actualComfyRefs, "renderWorkflowReferenceBlock").mockImplementation(
  (() => "") as never,
);
const getSystemProfileSpy = spyOn(actualSystem, "getSystemProfile").mockImplementation(
  (() => ({ recommended: { textModel: "fallback-model" } })) as never,
);

// ── fake agent-ts + route import (order matters, see header) ─────────

const fake = await startFakeAgentTs();
const prevAgentTsUrl = process.env.AGENT_TS_URL;
process.env.AGENT_TS_URL = fake.url;

const { POST } = await import("./route");

// ── helpers ──────────────────────────────────────────────────────────

function chatRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function defaultBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    messages: [{ role: "user", content: "hello agent" }],
    threadId: "thread-contract-1",
    runId: "run-contract-1",
    systemPrompt: "Be terse.",
    ...overrides,
  };
}

/** Drain the SSE response and parse it with the canonical parser. */
async function readSSE(res: Response): Promise<{ raw: string; events: AGUIEvent[] }> {
  const raw = await res.text();
  const parser = new SSEParser();
  const events = [...parser.feed(raw), ...parser.flush()];
  return { raw, events };
}

beforeEach(() => {
  fake.reset();
  dbState.createdRuns.length = 0;
  dbState.finishedRuns.length = 0;
  dbState.errorCalls.length = 0;
  dbState.savedEvents = 0;
});

afterEach(() => {
  for (const spy of Object.values(dbSpies)) spy.mockClear();
  resolveModelRouteSpy.mockClear();
  renderMemorySpy.mockClear();
  renderSkillIndexSpy.mockClear();
  renderWorkflowRefSpy.mockClear();
  getSystemProfileSpy.mockClear();
});

afterAll(async () => {
  mock.restore();
  if (prevAgentTsUrl === undefined) {
    delete process.env.AGENT_TS_URL;
  } else {
    process.env.AGENT_TS_URL = prevAgentTsUrl;
  }
  await fake.stop();
});

// ── the contract ─────────────────────────────────────────────────────

describe("POST /api/chat ↔ agent-ts contract", () => {
  test("runId echoes end-to-end; first agent TextMessageStart suppressed; order preserved; llm + system_prompt verbatim", async () => {
    fake.queueScript({
      events: [
        agt.runStarted(),
        agt.llmResolved(FIXED_ROUTE.provider, FIXED_ROUTE.model),
        agt.textStart("agent-m1"),
        agt.textContent("agent-m1", "hello "),
        agt.textEnd("agent-m1"),
        agt.toolCallStart("tc1", "web_search"),
        agt.toolCallResult("tc1", { hits: 2 }),
        agt.textStart("agent-m2"),
        agt.textContent("agent-m2", "world"),
        agt.textEnd("agent-m2"),
        agt.runFinished(),
      ],
    });

    const res = await POST(chatRequest(defaultBody()));
    expect(res.status).toBe(200);

    // (a) runId echo — response headers first, then every streamed event.
    expect(res.headers.get("X-Run-Id")).toBe("run-contract-1");
    expect(res.headers.get("X-Thread-Id")).toBe("thread-contract-1");
    const localMessageId = res.headers.get("X-Message-Id")!;
    expect(localMessageId).toBeTruthy();

    const { events } = await readSSE(res);
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect((event as { runId?: string }).runId).toBe("run-contract-1");
      expect(event.threadId).toBe("thread-contract-1");
    }

    // (c) parses with SSEParser, order preserved. The tail is the route's
    // own post-loop TextMessageEnd + RunFinished after the forwarded agent
    // RunFinished (documented route behaviour — both appear on the wire).
    expect(events.map((e) => e.type)).toEqual([
      "RunStarted", // local pre-emit
      "TextMessageStart", // local pre-emit
      "LLMResolved", // forwarded
      "TextMessageContent", // forwarded (agent-m1)
      "TextMessageEnd", // forwarded (agent-m1)
      "ToolCallStart", // forwarded
      "ToolCallResult", // forwarded
      "TextMessageStart", // forwarded (agent-m2)
      "TextMessageContent", // forwarded (agent-m2)
      "TextMessageEnd", // forwarded (agent-m2)
      "RunFinished", // forwarded agent RunFinished
      "TextMessageEnd", // route post-loop, local messageId
      "RunFinished", // route post-loop final
    ]);

    const deltas = events
      .filter((e) => e.type === "TextMessageContent")
      .map((e) => (e as { delta?: string }).delta);
    expect(deltas).toEqual(["hello ", "world"]);

    // (b) first agent-ts TextMessageStart (agent-m1) suppressed; the stream
    // holds the deck's pre-emit plus the second agent start (agent-m2).
    const starts = events.filter((e) => e.type === "TextMessageStart") as Array<{
      messageId: string;
    }>;
    expect(starts.map((s) => s.messageId)).toEqual([localMessageId, "agent-m2"]);

    // (d) llm + system_prompt reach the fake verbatim.
    expect(fake.runStarts).toHaveLength(1);
    const wire = fake.runStarts[0].body!;
    expect(wire.run_id).toBe("run-contract-1");
    expect(wire.thread_id).toBe("thread-contract-1");
    expect(wire.llm).toEqual({
      provider: FIXED_ROUTE.provider,
      model: FIXED_ROUTE.model,
      base_url: FIXED_ROUTE.baseUrl,
      api_key: FIXED_ROUTE.apiKey,
    });
    // Assembly: client systemPrompt is the only non-empty block (render
    // layers spied to ""), then augmentForModel applies per-model nudges.
    expect(wire.system_prompt).toBe(augmentForModel("Be terse.", FIXED_ROUTE.model).trim());

    // Ledger side: run created + finished with the canonical runId, no error.
    expect(dbState.createdRuns).toEqual(["run-contract-1"]);
    expect(dbState.finishedRuns).toEqual(["run-contract-1"]);
    expect(dbState.errorCalls).toEqual([]);
  });

  test("client-omitted runId: deck mints one and the same id flows to agent-ts and back", async () => {
    fake.queueScript({ events: [agt.runStarted(), agt.textStart("m1"), agt.runFinished()] });

    const body = defaultBody();
    delete body.runId;
    const res = await POST(chatRequest(body));
    expect(res.status).toBe(200);

    const runId = res.headers.get("X-Run-Id")!;
    expect(runId).toBeTruthy();

    // Drain first: the route contacts agent-ts from its background task,
    // which is only guaranteed to have run once the stream closes.
    const { events } = await readSSE(res);
    expect(fake.runStarts).toHaveLength(1);
    expect(fake.runStarts[0].body!.run_id as string).toBe(runId);

    for (const event of events) {
      expect((event as { runId?: string }).runId).toBe(runId);
    }
  });

  test("upstream RunError is forwarded and the run is not marked finished", async () => {
    fake.queueScript({
      events: [agt.runStarted(), agt.runError("model exploded")],
    });

    const res = await POST(chatRequest(defaultBody({ runId: "run-err-1" })));
    expect(res.status).toBe(200);

    const { events } = await readSSE(res);
    expect(events.map((e) => e.type)).toEqual(["RunStarted", "TextMessageStart", "RunError"]);
    const runError = events[events.length - 1] as { error?: { message?: string } };
    expect(runError.error?.message).toBe("model exploded");

    expect(dbState.errorCalls).toEqual([{ runId: "run-err-1", error: "model exploded" }]);
    expect(dbState.finishedRuns).toEqual([]);
  });

  test("malformed JSON body → 400 and agent-ts is never contacted", async () => {
    const res = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON body" });
    expect(fake.runStarts).toHaveLength(0);
  });

  test("empty messages array → 400 and agent-ts is never contacted", async () => {
    const res = await POST(chatRequest({ messages: [] }));
    expect(res.status).toBe(400);
    expect(fake.runStarts).toHaveLength(0);
  });

  test("non-string message content → 400 and agent-ts is never contacted", async () => {
    const res = await POST(
      chatRequest({ messages: [{ role: "user", content: { parts: [] } }] }),
    );
    expect(res.status).toBe(400);
    expect(fake.runStarts).toHaveLength(0);
  });

  test("runId violating the wire pattern → 400 and agent-ts is never contacted", async () => {
    const res = await POST(chatRequest(defaultBody({ runId: "bad run id!" })));
    expect(res.status).toBe(400);
    expect(fake.runStarts).toHaveLength(0);
  });
});
