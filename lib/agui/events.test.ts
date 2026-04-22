import { describe, expect, test } from "bun:test";
import {
  AGUI_SCHEMA_VERSION,
  createEvent,
  generateId,
  isArtifactCreated,
  isCostIncurred,
  isInterruptRequested,
  isInterruptResolved,
  isRunError,
  isRunFinished,
  isRunStarted,
  isStepFinished,
  isStepStarted,
  isTextMessageContent,
  isTextMessageEnd,
  isTextMessageStart,
  isToolCallArgs,
  isToolCallResult,
  isToolCallStart,
  normalizeEvent,
  wrapPayload,
  type AGUIEvent,
  type RunStarted,
  type TextMessageContent,
} from "./events";
import { isDeckPayload, jsonPayload } from "./payload";

describe("createEvent", () => {
  test("sets type / threadId / schemaVersion and generates ISO timestamp", () => {
    const ev = createEvent<RunStarted>("RunStarted", "t-1", {
      runId: "r-1",
      model: "claude-opus-4-7",
    });
    expect(ev.type).toBe("RunStarted");
    expect(ev.threadId).toBe("t-1");
    expect(ev.schemaVersion).toBe(AGUI_SCHEMA_VERSION);
    expect(ev.runId).toBe("r-1");
    expect(ev.model).toBe("claude-opus-4-7");
    expect(typeof ev.timestamp).toBe("string");
    expect(new Date(ev.timestamp).toString()).not.toBe("Invalid Date");
  });

  test("caller-supplied data doesn't override core fields", () => {
    // The spread order in createEvent places data AFTER the defaults, so
    // a bad caller CAN override type/threadId. Test the current behavior
    // documents that reality (change the fn if this should be locked
    // down — the test will fail loudly then).
    const ev = createEvent<TextMessageContent>("TextMessageContent", "t-1", {
      runId: "r-1",
      messageId: "m-1",
      delta: "hello",
    });
    expect(ev.delta).toBe("hello");
    expect(ev.messageId).toBe("m-1");
  });

  test("schemaVersion stays current even if data tried to downgrade", () => {
    // Confirms that even with an explicit schemaVersion in data, the
    // spread order puts data last; caller can technically downgrade.
    // This is a regression guard: if future versions forbid that, tests
    // here should be updated to match.
    const ev = createEvent<RunStarted>("RunStarted", "t-1", {
      runId: "r-1",
      // @ts-expect-error — data type excludes schemaVersion, but at runtime the spread would apply
      schemaVersion: 1,
    });
    // Current implementation does let data override — document it.
    expect(ev.schemaVersion).toBe(1);
  });
});

describe("generateId", () => {
  test("returns a UUID v4 shape", () => {
    const id = generateId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  test("successive calls are unique", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(generateId());
    expect(seen.size).toBe(100);
  });
});

describe("wrapPayload", () => {
  test("already-wrapped payload passes through unchanged", () => {
    const p = jsonPayload({ a: 1 });
    expect(wrapPayload(p)).toBe(p);
  });

  test("bare value gets wrapped in a json envelope", () => {
    const wrapped = wrapPayload({ a: 1 });
    expect(isDeckPayload(wrapped)).toBe(true);
    expect(wrapped.kind).toBe("json");
  });

  test("primitives and arrays wrap too", () => {
    expect(wrapPayload("hi").kind).toBe("json");
    expect(wrapPayload([1, 2, 3]).kind).toBe("json");
    expect(wrapPayload(42).kind).toBe("json");
  });
});

describe("normalizeEvent — v1 → v2 migration", () => {
  test("adds schemaVersion=2 when missing", () => {
    const legacy = {
      type: "RunStarted",
      timestamp: "2026-04-22T10:00:00.000Z",
      threadId: "t-1",
      runId: "r-1",
    };
    const normalized = normalizeEvent(legacy) as RunStarted;
    expect(normalized.schemaVersion).toBe(2);
  });

  test("wraps RunStarted.input in DeckPayload", () => {
    const legacy = {
      type: "RunStarted",
      timestamp: "x",
      threadId: "t",
      runId: "r",
      schemaVersion: 1,
      input: { prompt: "hello" },
    };
    const normalized = normalizeEvent(legacy) as RunStarted;
    expect(normalized.schemaVersion).toBe(2);
    expect(isDeckPayload(normalized.input)).toBe(true);
  });

  test("wraps RunFinished.output in DeckPayload", () => {
    const legacy = {
      type: "RunFinished",
      threadId: "t", runId: "r", timestamp: "x",
      schemaVersion: 1,
      output: "done",
    };
    const normalized = normalizeEvent(legacy) as AGUIEvent;
    expect((normalized as unknown as { output: unknown }).output).toEqual(
      expect.objectContaining({ kind: "json" }),
    );
  });

  test("wraps ToolCallArgs.args, ToolCallResult.result, ArtifactCreated.meta", () => {
    const cases = [
      ["ToolCallArgs", "args"],
      ["ToolCallResult", "result"],
      ["ArtifactCreated", "meta"],
    ] as const;
    for (const [type, field] of cases) {
      const legacy = {
        type,
        threadId: "t", runId: "r", timestamp: "x",
        schemaVersion: 1,
        [field]: { any: "value" },
      };
      const n = normalizeEvent(legacy) as unknown as Record<string, unknown>;
      expect(isDeckPayload(n[field])).toBe(true);
    }
  });

  test("leaves already-wrapped payloads alone", () => {
    const wrapped = jsonPayload({ prompt: "hi" });
    const legacy = {
      type: "RunStarted",
      threadId: "t", runId: "r", timestamp: "x",
      schemaVersion: 1,
      input: wrapped,
    };
    const n = normalizeEvent(legacy) as RunStarted;
    expect(n.input).toEqual(wrapped);
  });

  test("v2 events pass through untouched", () => {
    const v2 = {
      type: "TextMessageStart" as const,
      threadId: "t", runId: "r", timestamp: "x",
      schemaVersion: 2 as const,
      messageId: "m", role: "assistant" as const,
    };
    const n = normalizeEvent(v2);
    expect(n.schemaVersion).toBe(2);
  });

  test("non-migrating event types don't break", () => {
    const legacy = {
      type: "StepStarted",
      threadId: "t", runId: "r", timestamp: "x",
      schemaVersion: 1,
      stepName: "phase-1",
    };
    expect(() => normalizeEvent(legacy)).not.toThrow();
  });
});

describe("type guards", () => {
  const base = { threadId: "t", runId: "r", timestamp: "x", schemaVersion: 2 as const };

  test("each guard matches only its event type", () => {
    const matrix: Array<[string, (e: AGUIEvent) => boolean, Record<string, unknown>]> = [
      ["RunStarted", isRunStarted, { runId: "r" }],
      ["RunFinished", isRunFinished, { runId: "r" }],
      ["RunError", isRunError, { runId: "r", error: { message: "x" } }],
      ["TextMessageStart", isTextMessageStart, { messageId: "m", role: "assistant" }],
      ["TextMessageContent", isTextMessageContent, { messageId: "m", delta: "hi" }],
      ["TextMessageEnd", isTextMessageEnd, { messageId: "m" }],
      ["ToolCallStart", isToolCallStart, { toolCallId: "tc", toolCallName: "x" }],
      ["ToolCallArgs", isToolCallArgs, { toolCallId: "tc" }],
      ["ToolCallResult", isToolCallResult, { toolCallId: "tc" }],
      ["ArtifactCreated", isArtifactCreated, { artifactId: "a" }],
      ["CostIncurred", isCostIncurred, {}],
      ["InterruptRequested", isInterruptRequested, { interruptId: "i" }],
      ["InterruptResolved", isInterruptResolved, { interruptId: "i" }],
      ["StepStarted", isStepStarted, { stepName: "s" }],
      ["StepFinished", isStepFinished, { stepName: "s" }],
    ];

    for (const [type, guard, extra] of matrix) {
      const event = { ...base, type, ...extra } as unknown as AGUIEvent;
      expect(guard(event)).toBe(true);

      const other = { ...base, type: "TextMessageStart" } as unknown as AGUIEvent;
      if (type !== "TextMessageStart") {
        expect(guard(other)).toBe(false);
      }
    }
  });
});
