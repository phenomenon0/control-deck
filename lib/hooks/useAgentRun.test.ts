import { describe, expect, it } from "bun:test";

import { SSEParser, encodeSSE } from "../agui/sse";
import {
  createEvent,
  type AGUIEvent,
  type ArtifactCreated,
  type InterruptRequested,
  type RunFinished,
  type RunStarted,
  type TextMessageContent,
  type TextMessageEnd,
  type TextMessageStart,
  type ToolCallArgs,
  type ToolCallResult,
  type ToolCallStart,
} from "../agui/events";
import { jsonPayload } from "../agui/payload";
import {
  INITIAL_AGENT_RUN_STATE,
  type AgentActivitySegment,
  type AgentMessageSegment,
  type AgentReasoningSegment,
  type AgentRunState,
  type RunAction,
} from "../types/agentRun";
import { agentRunReducer, dispatchAGUIEvent, type AgentStreamEvent } from "./useAgentRun";

/**
 * Parse raw SSE text through the one codec and fold every event into the
 * reducer — the same path useAgentRun.send takes at runtime.
 */
function foldStream(
  raw: string,
  initialActions: RunAction[] = [],
  chunkSize = 7,
): { state: AgentRunState; actions: RunAction[] } {
  const parser = new SSEParser();
  const actions: RunAction[] = [...initialActions];
  const dispatch = (action: RunAction) => {
    actions.push(action);
  };
  for (let i = 0; i < raw.length; i += chunkSize) {
    for (const event of parser.feed(raw.slice(i, i + chunkSize))) {
      dispatchAGUIEvent(dispatch, event);
    }
  }
  for (const event of parser.flush()) {
    dispatchAGUIEvent(dispatch, event);
  }
  const state = actions.reduce(agentRunReducer, {
    ...INITIAL_AGENT_RUN_STATE,
    segments: [],
  } as AgentRunState);
  return { state, actions };
}

function streamOf(...events: AGUIEvent[]): string {
  return events.map(encodeSSE).join("");
}

describe("SSEParser-fed event folding into agentRunReducer", () => {
  it("folds a full run into the same timeline as the legacy decoder", () => {
    const reasoning = (type: string, extra: Record<string, unknown> = {}) =>
      ({
        type,
        timestamp: new Date().toISOString(),
        threadId: "t-1",
        runId: "run-1",
        schemaVersion: 2,
        ...extra,
      }) as unknown as AGUIEvent;

    const raw =
      streamOf(
        createEvent<RunStarted>("RunStarted", "t-1", { runId: "run-1", model: "test-model" }),
        reasoning("ReasoningStart"),
        reasoning("ReasoningMessageContent", { content: "thinking…" }),
        reasoning("ReasoningEnd"),
        createEvent<TextMessageStart>("TextMessageStart", "t-1", {
          runId: "run-1",
          messageId: "msg-1",
          role: "assistant",
        }),
        createEvent<TextMessageContent>("TextMessageContent", "t-1", {
          runId: "run-1",
          messageId: "msg-1",
          delta: "Hello, ",
        }),
        createEvent<TextMessageContent>("TextMessageContent", "t-1", {
          runId: "run-1",
          messageId: "msg-1",
          delta: "world",
        }),
        createEvent<TextMessageEnd>("TextMessageEnd", "t-1", { runId: "run-1", messageId: "msg-1" }),
        createEvent<ToolCallStart>("ToolCallStart", "t-1", {
          runId: "run-1",
          toolCallId: "tc-1",
          toolName: "execute_code",
        }),
        createEvent<ToolCallArgs>("ToolCallArgs", "t-1", {
          runId: "run-1",
          toolCallId: "tc-1",
          delta: "",
          args: jsonPayload({ code: "print(1)" }),
        }),
        createEvent<ToolCallResult>("ToolCallResult", "t-1", {
          runId: "run-1",
          toolCallId: "tc-1",
          result: jsonPayload({ message: "ok" }),
          success: true,
          durationMs: 42,
        }),
        createEvent<ArtifactCreated>("ArtifactCreated", "t-1", {
          runId: "run-1",
          toolCallId: "tc-1",
          artifactId: "art-1",
          url: "/artifacts/a.png",
          name: "a.png",
          mimeType: "image/png",
        }),
      ) +
      ": hb\n\n" + // heartbeat mid-stream must be ignored
      encodeSSE(createEvent<RunFinished>("RunFinished", "t-1", { runId: "run-1", threadTitle: "Greeting" }));

    const { state } = foldStream(raw, [{ type: "SUBMIT", content: "hi there" }]);

    expect(state.segments.map((s) => s.type)).toEqual([
      "user-message",
      "agent-reasoning",
      "agent-message",
      "agent-activity",
      "artifact",
    ]);

    const reasoning1 = state.segments[1] as AgentReasoningSegment;
    expect(reasoning1.content).toBe("thinking…");
    expect(reasoning1.isStreaming).toBe(false);

    const message = state.segments[2] as AgentMessageSegment;
    expect(message.content).toBe("Hello, world");
    expect(message.isStreaming).toBe(false);
    expect(message.complete).toBe(true);

    const activity = state.segments[3] as AgentActivitySegment;
    expect(activity.steps).toHaveLength(1);
    expect(activity.steps[0]).toMatchObject({
      toolCallId: "tc-1",
      toolName: "execute_code",
      status: "complete",
      args: { code: "print(1)" },
      durationMs: 42,
    });
    expect(activity.steps[0].result).toMatchObject({
      success: true,
      message: "ok",
    });

    expect(state.segments[4]).toMatchObject({
      type: "artifact",
      artifact: { id: "art-1", url: "/artifacts/a.png" },
    });

    expect(state.runState).toEqual({ phase: "idle" });
    expect(state.threadTitle).toBe("Greeting");
    expect(state.resolvedModel).toBe("test-model");
  });

  it("absorbs v1 schema drift on ToolCallArgs through normalizeEvent", () => {
    const v1Args = {
      type: "ToolCallArgs",
      timestamp: new Date().toISOString(),
      threadId: "t-1",
      runId: "run-2",
      schemaVersion: 1,
      toolCallId: "tc-v1",
      args: { q: "x" }, // v1: raw object, no DeckPayload envelope
    } as unknown as AGUIEvent;

    const raw = streamOf(
      createEvent<RunStarted>("RunStarted", "t-1", { runId: "run-2" }),
      createEvent<ToolCallStart>("ToolCallStart", "t-1", {
        runId: "run-2",
        toolCallId: "tc-v1",
        toolName: "web_search",
      }),
      v1Args,
    );

    const { state } = foldStream(raw);
    const activity = state.segments.find((s) => s.type === "agent-activity") as
      | AgentActivitySegment
      | undefined;
    expect(activity?.steps[0].args).toEqual({ q: "x" });
  });

  it("skips heartbeats, [DONE], malformed frames, and unknown types", () => {
    const raw =
      ": hb\n\n" +
      "data: [DONE]\n\n" +
      "data: {broken json\n\n" +
      `data: ${JSON.stringify({ type: "Connected", timestamp: new Date().toISOString() })}\n\n`;

    const { state, actions } = foldStream(raw);
    expect(actions).toHaveLength(0);
    expect(state).toEqual({ ...INITIAL_AGENT_RUN_STATE, segments: [] });
  });

  it("does not route InterruptRequested into the reducer", () => {
    const interrupt = createEvent<InterruptRequested>("InterruptRequested", "t-1", {
      runId: "run-3",
      toolCallId: "tc-9",
      toolName: "execute_code",
      args: jsonPayload({ code: "rm -rf /" }),
    });

    const actions: RunAction[] = [];
    dispatchAGUIEvent((a) => actions.push(a), interrupt as AgentStreamEvent);
    expect(actions).toHaveLength(0);
  });
});
