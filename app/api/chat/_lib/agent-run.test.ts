/**
 * Tests for app/api/chat/_lib/agent-run.ts — the wire message sanitiser,
 * the pinned /runs request shape, and the T17 tool-call replay feed.
 * startAgentRun itself is network I/O and is covered by the route load
 * smoke (and the route contract tests).
 *
 * Replay-feed db access is spied on the real barrel (publish.test.ts
 * pattern), never mock.module; mock.restore() in afterAll reverts.
 */

import { afterAll, afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as db from "@/lib/agui/db";
import type { AGUIEvent } from "@/lib/agui/events";
import { jsonPayload } from "@/lib/agui/payload";
import type { ModelRoute } from "@/lib/engine/resolve";
import {
  buildAgentMessages,
  buildStartRunRequest,
  buildToolReplayBlocks,
  exchangesToMessages,
  extractToolExchanges,
  mergeReplayBlocks,
  REPLAY_MAX_TOOL_CALLS,
  REPLAY_RESULT_MAX_CHARS,
  type AgentGOMessage,
  type ReplayBlock,
  type ToolExchange,
} from "./agent-run";

const getRunsSpy = spyOn(db, "getRuns").mockImplementation((() => []) as never);
const getEventsSpy = spyOn(db, "getEvents").mockImplementation((() => []) as never);
// raiseWarning persists WarningRaised when given a runId — keep the real
// ledger out of unit tests.
const saveEventSpy = spyOn(db, "saveEvent").mockImplementation((() => {}) as never);

afterAll(() => {
  mock.restore();
});

beforeEach(() => {
  getRunsSpy.mockClear();
  getRunsSpy.mockImplementation((() => []) as never);
  getEventsSpy.mockClear();
  getEventsSpy.mockImplementation((() => []) as never);
  saveEventSpy.mockClear();
  saveEventSpy.mockImplementation((() => {}) as never);
});

const ENV_KEYS = ["WORKSPACE_ROOT", "AGENT_MAX_STEPS"] as const;
const savedEnv = new Map<string, string | undefined>();

function setEnv(key: (typeof ENV_KEYS)[number], value: string | undefined) {
  if (!savedEnv.has(key)) savedEnv.set(key, process.env[key]);
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    const original = savedEnv.get(key);
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
    savedEnv.delete(key);
  }
});

describe("buildAgentMessages", () => {
  test("passes user content through untouched", () => {
    const out = buildAgentMessages([{ role: "user", content: "keep ![x](http://y/a.png)" }]);
    expect(out).toEqual([{ role: "user", content: "keep ![x](http://y/a.png)" }]);
  });

  test("strips fake tool-call patterns from assistant history", () => {
    const out = buildAgentMessages([
      { role: "assistant", content: "done ![plot](http://x/y.png)" },
    ]);
    expect(out).toEqual([{ role: "assistant", content: "done" }]);
  });

  test("replaces assistant turns that strip to nothing with a placeholder", () => {
    const out = buildAgentMessages([
      { role: "assistant", content: "Here is an image of a cat." },
    ]);
    expect(out).toEqual([
      { role: "assistant", content: "[Previous response contained only generated content]" },
    ]);
  });

  test("drops whitespace-only user messages", () => {
    const out = buildAgentMessages([
      { role: "user", content: "hi" },
      { role: "user", content: "   " },
    ]);
    expect(out).toEqual([{ role: "user", content: "hi" }]);
  });

  test("preserves order and roles across a conversation", () => {
    const out = buildAgentMessages([
      { role: "user", content: "one" },
      { role: "assistant", content: "two" },
      { role: "user", content: "three" },
    ]);
    expect(out.map(m => m.role)).toEqual(["user", "assistant", "user"]);
    expect(out.map(m => m.content)).toEqual(["one", "two", "three"]);
  });
});

describe("buildStartRunRequest", () => {
  const route: ModelRoute = {
    provider: "ollama",
    model: "qwen3:4b",
    baseUrl: "http://localhost:11434/v1",
    apiKey: undefined,
    source: "env",
  };

  const base = {
    messages: [{ role: "user" as const, content: "hi" }],
    threadId: "t1",
    runId: "r1",
    assembledSystemPrompt: "SYS",
    route,
    selectedModel: "qwen3:4b",
    toolBridgeUrl: "http://deck/api/tools/bridge",
    mcpUrl: "http://deck/api/mcp/tools",
  };

  test("assembles the pinned wire shape", () => {
    setEnv("WORKSPACE_ROOT", undefined);
    setEnv("AGENT_MAX_STEPS", undefined);
    expect(buildStartRunRequest(base)).toEqual({
      messages: [{ role: "user", content: "hi" }],
      thread_id: "t1",
      system_prompt: "SYS",
      run_id: "r1",
      workspace_root: undefined,
      mode: "BUILD",
      max_steps: 25,
      llm: {
        provider: "ollama",
        model: "qwen3:4b",
        base_url: "http://localhost:11434/v1",
        api_key: null,
      },
      tool_bridge_url: "http://deck/api/tools/bridge",
      mcp_url: "http://deck/api/mcp/tools",
    });
  });

  test("sends system_prompt even when the assembled prompt is empty", () => {
    // Why: an absent field makes agent-ts fall back to its own bootstrap
    // files (MEMORY.md/SOUL.md). Present-but-empty says "a deck is in front
    // and assembled nothing" — persona/memory the user turned off stay off.
    const out = buildStartRunRequest({ ...base, assembledSystemPrompt: "" });
    expect(out.system_prompt).toBe("");
  });

  test("passes a resolved api key through", () => {
    const out = buildStartRunRequest({ ...base, route: { ...route, apiKey: "sk-1" } });
    expect(out.llm?.api_key).toBe("sk-1");
  });

  test("honours env overrides for workspace and step budget", () => {
    setEnv("WORKSPACE_ROOT", "/tmp/ws");
    setEnv("AGENT_MAX_STEPS", "7");
    const out = buildStartRunRequest(base);
    expect(out.workspace_root).toBe("/tmp/ws");
    expect(out.max_steps).toBe(7);
  });
});

/* ── T17 tool-call replay feed ────────────────────────────────────── */

/** Minimal AGUIEvent factory — only `type` + listed fields matter here. */
function ev(partial: Record<string, unknown>): AGUIEvent {
  return {
    timestamp: "2026-07-18T00:00:00Z",
    threadId: "th",
    runId: "r",
    schemaVersion: 2,
    ...partial,
  } as AGUIEvent;
}

function runRow(id: string) {
  return {
    id,
    thread_id: "th",
    started_at: "t",
    ended_at: "t",
    status: "finished" as const,
    model: null,
    input_tokens: 0,
    output_tokens: 0,
    cost_usd: 0,
    preview: null,
  };
}

describe("extractToolExchanges", () => {
  test("pairs start + result; parallel calls keep result-arrival order", () => {
    const out = extractToolExchanges([
      ev({ type: "ToolCallStart", toolCallId: "a", toolName: "glob" }),
      ev({ type: "ToolCallStart", toolCallId: "b", toolName: "grep" }),
      ev({ type: "ToolCallResult", toolCallId: "b", result: jsonPayload("br"), success: true }),
      ev({ type: "ToolCallResult", toolCallId: "a", result: jsonPayload("ar"), success: true }),
    ]);
    expect(out.map(x => x.id)).toEqual(["b", "a"]);
    expect(out.map(x => x.name)).toEqual(["grep", "glob"]);
    expect(out.map(x => x.content)).toEqual(["br", "ar"]);
    expect(out.every(x => !x.isError)).toBe(true);
  });

  test("arguments come from ToolCallStart args, then ToolCallArgs payload, then concatenated deltas", () => {
    const out = extractToolExchanges([
      ev({ type: "ToolCallStart", toolCallId: "a", toolName: "t", args: jsonPayload({ from: "start" }) }),
      ev({ type: "ToolCallStart", toolCallId: "b", toolName: "t" }),
      ev({ type: "ToolCallArgs", toolCallId: "b", delta: "", args: jsonPayload({ from: "argsEvent" }) }),
      ev({ type: "ToolCallStart", toolCallId: "c", toolName: "t" }),
      ev({ type: "ToolCallArgs", toolCallId: "c", delta: '{"fro' }),
      ev({ type: "ToolCallArgs", toolCallId: "c", delta: 'm":"delta"}' }),
      ev({ type: "ToolCallStart", toolCallId: "d", toolName: "t" }),
      ev({ type: "ToolCallArgs", toolCallId: "d", delta: "not json" }),
      ev({ type: "ToolCallResult", toolCallId: "a", result: jsonPayload("r"), success: true }),
      ev({ type: "ToolCallResult", toolCallId: "b", result: jsonPayload("r"), success: true }),
      ev({ type: "ToolCallResult", toolCallId: "c", result: jsonPayload("r"), success: true }),
      ev({ type: "ToolCallResult", toolCallId: "d", result: jsonPayload("r"), success: true }),
    ]);
    expect(out.find(x => x.id === "a")?.arguments).toEqual({ from: "start" });
    expect(out.find(x => x.id === "b")?.arguments).toEqual({ from: "argsEvent" });
    expect(out.find(x => x.id === "c")?.arguments).toEqual({ from: "delta" });
    // Unparseable deltas → arguments omitted, never invented.
    expect(out.find(x => x.id === "d")?.arguments).toBeUndefined();
  });

  test("drops unpaired starts AND unpaired results — nothing unpaired leaves", () => {
    const out = extractToolExchanges([
      ev({ type: "ToolCallStart", toolCallId: "no-result", toolName: "read_file" }),
      ev({ type: "ToolCallResult", toolCallId: "no-start", result: jsonPayload("x"), success: true }),
      ev({ type: "ToolCallStart", toolCallId: "paired", toolName: "glob" }),
      ev({ type: "ToolCallResult", toolCallId: "paired", result: jsonPayload("ok"), success: true }),
    ]);
    expect(out.map(x => x.id)).toEqual(["paired"]);
  });

  test("marks error results via success === false", () => {
    const out = extractToolExchanges([
      ev({ type: "ToolCallStart", toolCallId: "a", toolName: "bash" }),
      ev({ type: "ToolCallResult", toolCallId: "a", result: jsonPayload("exit 1"), success: false }),
    ]);
    expect(out[0].isError).toBe(true);
  });

  test("flattens the pi {content:[text]} result shape; stringifies plain objects", () => {
    const out = extractToolExchanges([
      ev({ type: "ToolCallStart", toolCallId: "a", toolName: "t" }),
      ev({
        type: "ToolCallResult",
        toolCallId: "a",
        result: jsonPayload({ content: [{ type: "text", text: "one" }, { type: "text", text: "two" }], details: {} }),
        success: true,
      }),
      ev({ type: "ToolCallStart", toolCallId: "b", toolName: "t" }),
      ev({ type: "ToolCallResult", toolCallId: "b", result: jsonPayload({ hits: 3 }), success: true }),
    ]);
    expect(out.find(x => x.id === "a")?.content).toBe("one\ntwo");
    expect(out.find(x => x.id === "b")?.content).toBe(JSON.stringify({ hits: 3 }));
  });

  test("caps result content at REPLAY_RESULT_MAX_CHARS", () => {
    const big = "x".repeat(REPLAY_RESULT_MAX_CHARS + 500);
    const out = extractToolExchanges([
      ev({ type: "ToolCallStart", toolCallId: "a", toolName: "t" }),
      ev({ type: "ToolCallResult", toolCallId: "a", result: jsonPayload(big), success: true }),
    ]);
    expect(out[0].content.length).toBe(REPLAY_RESULT_MAX_CHARS + "…[truncated]".length);
    expect(out[0].content.endsWith("…[truncated]")).toBe(true);
  });
});

describe("exchangesToMessages", () => {
  test("materializes the exact wire pair sequence", () => {
    const exchanges: ToolExchange[] = [
      { id: "a", name: "glob", arguments: { p: "*" }, content: "files", isError: false },
      { id: "b", name: "bash", content: "exit 1", isError: true },
    ];
    expect(exchangesToMessages(exchanges)).toEqual([
      {
        role: "assistant",
        content: "",
        tool_calls: [
          { id: "a", name: "glob", arguments: { p: "*" } },
          { id: "b", name: "bash" }, // arguments key omitted, not undefined
        ],
      },
      { role: "tool", content: "files", tool_call_id: "a", name: "glob", is_error: false },
      { role: "tool", content: "exit 1", tool_call_id: "b", name: "bash", is_error: true },
    ]);
  });

  test("empty input → empty output", () => {
    expect(exchangesToMessages([])).toEqual([]);
  });
});

describe("mergeReplayBlocks", () => {
  const block = (priorIndex: number, tag: string): ReplayBlock => ({
    priorIndex,
    messages: [
      { role: "assistant", content: "", tool_calls: [{ id: tag, name: "t" }] },
      { role: "tool", content: tag, tool_call_id: tag, name: "t", is_error: false },
    ],
  });
  const tags = (msgs: AgentGOMessage[]) =>
    msgs.map(m => m.tool_calls?.[0]?.id ?? m.tool_call_id ?? m.role);

  test("no blocks → messages unchanged (identity)", () => {
    const msgs: AgentGOMessage[] = [{ role: "user", content: "hi" }];
    expect(mergeReplayBlocks(msgs, [])).toBe(msgs);
  });

  test("well-formed history: each block lands right after its run's user message", () => {
    const history: AgentGOMessage[] = [
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "u2" },
      { role: "assistant", content: "a2" },
      { role: "user", content: "u3-current" },
    ];
    const out = mergeReplayBlocks(history, [block(0, "new"), block(1, "old")]);
    expect(out.map(m => m.content)).toEqual([
      "u1",
      "", "old", // old run's block after u1
      "a1",
      "u2",
      "", "new", // newest prior run's block after u2
      "a2",
      "u3-current",
    ]);
    expect(tags(out)).toEqual([
      "user",
      "old", "old",
      "assistant",
      "user",
      "new", "new",
      "assistant",
      "user",
    ]);
  });

  test("block whose anchor was trimmed from history parks before the current user message", () => {
    const history: AgentGOMessage[] = [{ role: "user", content: "only-current" }];
    const out = mergeReplayBlocks(history, [block(3, "ancient")]);
    expect(out.map(m => m.content)).toEqual(["", "ancient", "only-current"]);
  });

  test("degenerate history without user messages keeps blocks at the tail", () => {
    const history: AgentGOMessage[] = [{ role: "assistant", content: "a1" }];
    const out = mergeReplayBlocks(history, [block(0, "x")]);
    expect(out.map(m => m.content)).toEqual(["a1", "", "x"]);
  });
});

describe("buildToolReplayBlocks", () => {
  const toolEvents = (id: string, name = "glob"): AGUIEvent[] => [
    ev({ type: "ToolCallStart", toolCallId: id, toolName: name, runId: "run-x" }),
    ev({ type: "ToolCallResult", toolCallId: id, result: jsonPayload("ok"), success: true, runId: "run-x" }),
  ];

  test("skips the current run and text-only runs but keeps their ordinal positions", () => {
    getRunsSpy.mockImplementation((() => [
      runRow("run-current"), // excluded by id
      runRow("run-newest-prior"), // priorIndex 0 — no tool events
      runRow("run-older"), // priorIndex 1 — has tools
    ]) as never);
    getEventsSpy.mockImplementation(((runId: string) =>
      runId === "run-older" ? toolEvents("tc-old") : []) as never);

    const blocks = buildToolReplayBlocks("th", "run-current");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].priorIndex).toBe(1); // ordinal preserved despite the gap
    expect(blocks[0].messages[0].tool_calls).toEqual([{ id: "tc-old", name: "glob" }]);
    expect(getEventsSpy.mock.calls.map(c => c[0])).toEqual(["run-newest-prior", "run-older"]);
  });

  test("caps the total at REPLAY_MAX_TOOL_CALLS, newest runs first", () => {
    getRunsSpy.mockImplementation((() => [runRow("r0"), runRow("r1")]) as never);
    const many = (prefix: string, n: number): AGUIEvent[] =>
      Array.from({ length: n }, (_, i) => [
        ev({ type: "ToolCallStart", toolCallId: `${prefix}${i}`, toolName: "t" }),
        ev({ type: "ToolCallResult", toolCallId: `${prefix}${i}`, result: jsonPayload("x"), success: true }),
      ]).flat();
    getEventsSpy.mockImplementation(((runId: string) =>
      runId === "r0" ? many("a", REPLAY_MAX_TOOL_CALLS - 2) : many("b", 8)) as never);

    const blocks = buildToolReplayBlocks("th", "elsewhere");
    const total = blocks.reduce((n, b) => n + (b.messages[0].tool_calls?.length ?? 0), 0);
    expect(total).toBe(REPLAY_MAX_TOOL_CALLS);
    // Newest run got its full budget; the older run kept only its earliest 2.
    expect(blocks[0].messages[0].tool_calls).toHaveLength(REPLAY_MAX_TOOL_CALLS - 2);
    expect(blocks[1].messages[0].tool_calls?.map(c => c.id)).toEqual(["b0", "b1"]);
  });

  test("ledger failure degrades to no replay (warning raised, never throws)", () => {
    getRunsSpy.mockImplementation((() => {
      throw new Error("sqlite gone");
    }) as never);
    expect(buildToolReplayBlocks("th", "r1")).toEqual([]);
    // The WarningRaised for the failure was persisted via the spied saveEvent.
    expect(saveEventSpy).toHaveBeenCalled();
  });
});
