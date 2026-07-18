/**
 * Tests for app/api/chat/_lib/publish.ts — the pure agent-event → AG-UI
 * mapping (mapAgentEvent) plus the persist/publish wiring around it.
 *
 * Spies on the real db barrel + hub singleton, not mock.module: bun module
 * mocks are process-global and leak into later test files; spies keep the
 * real export shape and mock.restore() reverts them (afterAll).
 */

import { afterAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as db from "@/lib/agui/db";
import { hub } from "@/lib/agui/hub";
import type {
  ArtifactCreated,
  InterruptRequested,
  InterruptResolved,
  LLMResolved,
  RunError,
  RunFinished,
  TextMessageContent,
  TextMessageStart,
  ToolCallArgs,
  ToolCallResult,
  ToolCallStart,
} from "@/lib/agui/events";
import { jsonPayload, type DeckPayload } from "@/lib/agui/payload";
import {
  mapAgentEvent,
  mapAndPublishEvent,
  parseAgentEvent,
  type AgentGOEvent,
} from "./publish";

const saved: unknown[] = [];
const published: Array<{ threadId: string; event: unknown }> = [];

const saveEventSpy = spyOn(db, "saveEvent").mockImplementation(((evt: unknown) => {
  saved.push(evt);
}) as never);
const publishSpy = spyOn(hub, "publish").mockImplementation(((threadId: string, evt: unknown) => {
  published.push({ threadId, event: evt });
}) as never);

afterAll(() => {
  mock.restore();
});

beforeEach(() => {
  saved.length = 0;
  published.length = 0;
});

const T = "thread-1";
const R = "run-1";
const M = "msg-1";
const freshState = () => ({ sawFirstTextStart: false });

describe("parseAgentEvent", () => {
  test("parses valid JSON", () => {
    expect(parseAgentEvent('{"type":"RunStarted"}')).toEqual({ type: "RunStarted" });
  });

  test("returns null on malformed data instead of throwing", () => {
    expect(parseAgentEvent("not json")).toBeNull();
  });
});

describe("mapAgentEvent — lifecycle", () => {
  test("RunStarted is dropped (already emitted locally)", () => {
    expect(mapAgentEvent({ type: "RunStarted" }, T, R, M, freshState())).toBeNull();
  });

  test("RunFinished carries token/cost telemetry", () => {
    const e = mapAgentEvent(
      { type: "RunFinished", inputTokens: 1, outputTokens: 2, costUsd: 0.5 },
      T, R, M, freshState()
    ) as RunFinished;
    expect(e.type).toBe("RunFinished");
    expect(e.runId).toBe(R);
    expect(e.inputTokens).toBe(1);
    expect(e.outputTokens).toBe(2);
    expect(e.costUsd).toBe(0.5);
  });

  test("RunError falls back to a generic message", () => {
    const e = mapAgentEvent({ type: "RunError" }, T, R, M, freshState()) as RunError;
    expect(e.error).toEqual({ message: "Unknown error" });
  });

  test("RunError passes the upstream message through", () => {
    const e = mapAgentEvent(
      { type: "RunError", error: { message: "boom" } },
      T, R, M, freshState()
    ) as RunError;
    expect(e.error).toEqual({ message: "boom" });
  });

  test("LLMResolved defaults provider/model to unknown", () => {
    const e = mapAgentEvent({ type: "LLMResolved" }, T, R, M, freshState()) as LLMResolved;
    expect(e.provider).toBe("unknown");
    expect(e.modelId).toBe("unknown");
  });

  test("LLMResolved carries attribution fields", () => {
    const e = mapAgentEvent(
      { type: "LLMResolved", provider: "ollama", modelId: "qwen", label: "Qwen", local: true, resolveMs: 12 },
      T, R, M, freshState()
    ) as LLMResolved;
    expect(e.provider).toBe("ollama");
    expect(e.modelId).toBe("qwen");
    expect(e.label).toBe("Qwen");
    expect(e.local).toBe(true);
    expect(e.resolveMs).toBe(12);
  });
});

describe("mapAgentEvent — text messages", () => {
  test("first TextMessageStart is suppressed, later ones forwarded", () => {
    const state = freshState();
    expect(mapAgentEvent({ type: "TextMessageStart" }, T, R, M, state)).toBeNull();
    expect(state.sawFirstTextStart).toBe(true);

    const e = mapAgentEvent({ type: "TextMessageStart" }, T, R, M, state) as TextMessageStart;
    expect(e.type).toBe("TextMessageStart");
    expect(e.role).toBe("assistant");
    expect(e.messageId).toBe(M); // falls back to the gateway message id
  });

  test("forwarded TextMessageStart prefers the upstream messageId", () => {
    const state = { sawFirstTextStart: true };
    const e = mapAgentEvent(
      { type: "TextMessageStart", messageId: "upstream-m" },
      T, R, M, state
    ) as TextMessageStart;
    expect(e.messageId).toBe("upstream-m");
  });

  test("TextMessageContent carries the delta with messageId fallback", () => {
    const e = mapAgentEvent(
      { type: "TextMessageContent", delta: "abc" },
      T, R, M, freshState()
    ) as TextMessageContent;
    expect(e.delta).toBe("abc");
    expect(e.messageId).toBe(M);
  });

  test("TextMessageContent defaults an empty delta", () => {
    const e = mapAgentEvent({ type: "TextMessageContent" }, T, R, M, freshState()) as TextMessageContent;
    expect(e.delta).toBe("");
  });
});

describe("mapAgentEvent — tool calls", () => {
  test("ToolCallStart defaults id and name", () => {
    const e = mapAgentEvent({ type: "ToolCallStart" }, T, R, M, freshState()) as ToolCallStart;
    expect(e.toolCallId).toBeTruthy();
    expect(e.toolName).toBe("unknown");
  });

  test("ToolCallArgs passes a DeckPayload through untouched", () => {
    const glyph: DeckPayload = { kind: "glyph", glyph: "a:1" };
    const e = mapAgentEvent(
      { type: "ToolCallArgs", toolCallId: "tc1", args: glyph as never },
      T, R, M, freshState()
    ) as ToolCallArgs;
    expect(e.args).toBe(glyph);
    expect(e.toolCallId).toBe("tc1");
  });

  test("ToolCallArgs wraps the legacy {format,data} shape as JSON", () => {
    const e = mapAgentEvent(
      { type: "ToolCallArgs", toolCallId: "tc1", args: { format: "json", data: { a: 1 } } },
      T, R, M, freshState()
    ) as ToolCallArgs;
    expect(e.args).toEqual(jsonPayload({ a: 1 }));
  });

  test("ToolCallArgs wraps a raw value and tolerates absence", () => {
    const raw = mapAgentEvent(
      { type: "ToolCallArgs", toolCallId: "tc1", args: { foo: 1 } as never },
      T, R, M, freshState()
    ) as ToolCallArgs;
    expect(raw.args).toEqual(jsonPayload({ foo: 1 }));

    const absent = mapAgentEvent({ type: "ToolCallArgs" }, T, R, M, freshState()) as ToolCallArgs;
    expect(absent.args).toBeUndefined();
    expect(absent.toolCallId).toBeTruthy(); // generated
  });

  test("ToolCallResult passes a DeckPayload through with telemetry", () => {
    const glyph: DeckPayload = { kind: "glyph", glyph: "b:2" };
    const e = mapAgentEvent(
      { type: "ToolCallResult", toolCallId: "tc1", result: glyph as never, success: false, durationMs: 7 },
      T, R, M, freshState()
    ) as ToolCallResult;
    expect(e.result).toBe(glyph);
    expect(e.success).toBe(false);
    expect(e.durationMs).toBe(7);
  });

  test("ToolCallResult wraps legacy/raw/absent results", () => {
    const legacy = mapAgentEvent(
      { type: "ToolCallResult", result: { format: "json", data: [1, 2] } },
      T, R, M, freshState()
    ) as ToolCallResult;
    expect(legacy.result).toEqual(jsonPayload([1, 2]));

    const raw = mapAgentEvent(
      { type: "ToolCallResult", result: "plain" as never },
      T, R, M, freshState()
    ) as ToolCallResult;
    expect(raw.result).toEqual(jsonPayload("plain"));

    const absent = mapAgentEvent({ type: "ToolCallResult" }, T, R, M, freshState()) as ToolCallResult;
    expect(absent.result).toEqual(jsonPayload({}));
  });
});

describe("mapAgentEvent — interrupts and artifacts", () => {
  test("InterruptRequested prefers the nested data envelope", () => {
    const e = mapAgentEvent(
      {
        type: "InterruptRequested",
        toolCallId: "top-id",
        toolName: "top-name",
        data: { toolCallId: "nested-id", toolName: "nested-name", args: { x: 1 } },
      },
      T, R, M, freshState()
    ) as InterruptRequested;
    expect(e.toolCallId).toBe("nested-id");
    expect(e.toolName).toBe("nested-name");
    expect(e.args).toEqual(jsonPayload({ x: 1 }));
  });

  test("InterruptRequested falls back to legacy top-level args", () => {
    const e = mapAgentEvent(
      { type: "InterruptRequested", toolCallId: "tc1", toolName: "rm", args: { format: "json", data: { y: 2 } } },
      T, R, M, freshState()
    ) as InterruptRequested;
    expect(e.toolCallId).toBe("tc1");
    expect(e.toolName).toBe("rm");
    expect(e.args).toEqual(jsonPayload({ y: 2 }));
  });

  test("InterruptRequested omits args when none are present", () => {
    const e = mapAgentEvent({ type: "InterruptRequested" }, T, R, M, freshState()) as InterruptRequested;
    expect(e.args).toBeUndefined();
    expect(e.toolCallId).toBeTruthy(); // generated
    expect(e.toolName).toBe("unknown");
  });

  test("InterruptResolved maps the decision string to approved", () => {
    const approved = mapAgentEvent(
      { type: "InterruptResolved", data: { toolCallId: "tc1", decision: "approved", reason: "ok" } },
      T, R, M, freshState()
    ) as InterruptResolved;
    expect(approved.toolCallId).toBe("tc1");
    expect(approved.approved).toBe(true);
    expect(approved.reason).toBe("ok");

    const rejected = mapAgentEvent(
      { type: "InterruptResolved", data: { decision: "rejected" } },
      T, R, M, freshState()
    ) as InterruptResolved;
    expect(rejected.approved).toBe(false);
  });

  test("InterruptResolved falls back to the legacy approved flag", () => {
    const e = mapAgentEvent(
      { type: "InterruptResolved", toolCallId: "tc9", approved: true, reason: "legacy" },
      T, R, M, freshState()
    ) as InterruptResolved;
    expect(e.toolCallId).toBe("tc9");
    expect(e.approved).toBe(true);
    expect(e.reason).toBe("legacy");

    const absent = mapAgentEvent({ type: "InterruptResolved" }, T, R, M, freshState()) as InterruptResolved;
    expect(absent.approved).toBe(false);
  });

  test("ArtifactCreated applies defaults and generates an id", () => {
    const e = mapAgentEvent({ type: "ArtifactCreated" }, T, R, M, freshState()) as ArtifactCreated;
    expect(e.artifactId).toBeTruthy();
    expect(e.url).toBe("");
    expect(e.name).toBe("artifact");
    expect(e.mimeType).toBe("application/octet-stream");
  });

  test("ArtifactCreated carries provided fields", () => {
    const e = mapAgentEvent(
      { type: "ArtifactCreated", artifactId: "a1", toolCallId: "tc1", url: "/u", name: "img", mimeType: "image/png" },
      T, R, M, freshState()
    ) as ArtifactCreated;
    expect(e.artifactId).toBe("a1");
    expect(e.toolCallId).toBe("tc1");
    expect(e.url).toBe("/u");
    expect(e.name).toBe("img");
    expect(e.mimeType).toBe("image/png");
  });
});

describe("mapAgentEvent — unknown types", () => {
  test("returns null and surfaces a WarningRaised through the warn channel", () => {
    const e = mapAgentEvent({ type: "FutureEvent" } as AgentGOEvent, T, R, M, freshState());
    expect(e).toBeNull();

    expect(saved).toHaveLength(1);
    const warning = saved[0] as { type: string; source: string; threadId: string; runId: string; message: string };
    expect(warning.type).toBe("WarningRaised");
    expect(warning.source).toBe("chat.event-map");
    expect(warning.threadId).toBe(T);
    expect(warning.runId).toBe(R);
    expect(warning.message).toContain("FutureEvent");
  });
});

describe("mapAndPublishEvent — wiring", () => {
  test("persists and publishes the mapped event, then returns it", () => {
    const e = mapAndPublishEvent({ type: "RunFinished", inputTokens: 3 }, T, R, M, freshState());
    expect(e).not.toBeNull();
    expect(saved).toEqual([e]);
    expect(published).toEqual([{ threadId: T, event: e }]);
  });

  test("dropped events are neither saved nor published", () => {
    const e = mapAndPublishEvent({ type: "RunStarted" }, T, R, M, freshState());
    expect(e).toBeNull();
    expect(saved).toHaveLength(0);
    expect(published).toHaveLength(0);
  });
});
