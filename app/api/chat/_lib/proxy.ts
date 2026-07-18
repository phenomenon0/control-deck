/**
 * agent-ts event-stream consumption for POST /api/chat.
 *
 * Background proxy loop: write the locally pre-emitted prelude, start the
 * agent-ts run, then forward every upstream event (mapped to AG-UI,
 * persisted, republished) into the client-facing SSE stream. Terminals:
 *   - RunFinished / `event: done` → TextMessageEnd + RunFinished, run row 'finished'
 *   - RunError → forwarded, run row 'error' (never overwritten by finishRun)
 *   - client abort → run row marked "aborted", no further events
 *   - transport/agent-ts failure → RunError event, run row 'error'
 */

import { raiseWarning } from "@/lib/agui/warn";
import {
  createEvent,
  type RunStarted,
  type TextMessageStart,
  type TextMessageEnd,
  type RunFinished,
  type RunError,
} from "@/lib/agui/events";
import {
  finishRun,
  errorRun,
  updateRunPreview,
  getThread,
} from "@/lib/agui/db";
import { retryingFetch, AgentGoUnavailableError } from "@/lib/agentgo/client";
import { AGENTGO_URL, withAgentTsAuth } from "@/lib/agentgo/launcher";
import {
  startAgentRun,
  type AgentGOStartRunRequest,
} from "./agent-run";
import {
  mapAndPublishEvent,
  parseAgentEvent,
  persistAndPublish,
} from "./publish";
import type { ChatSSEStream } from "./stream";

export interface ProxyAgentRunOptions {
  agentRequest: AgentGOStartRunRequest;
  signal?: AbortSignal;
  threadId: string;
  runId: string;
  messageId: string;
  /** Locally pre-emitted events, written to the stream before upstream connects. */
  prelude: { runStarted: RunStarted; msgStart: TextMessageStart };
  stream: ChatSSEStream;
}

export async function proxyAgentRun(opts: ProxyAgentRunOptions): Promise<void> {
  const { agentRequest, signal, threadId, runId, messageId, prelude, stream } = opts;
  let fullText = "";
  // Track per-stream state used by mapAndPublishEvent — currently tells us
  // whether to suppress the first TextMessageStart from agent-ts (the deck
  // pre-emitted one locally) vs forwarding the ones that begin each model
  // turn after a tool-call round.
  const eventState = { sawFirstTextStart: false };

  try {
    // Write initial locally-emitted events to the SSE stream
    await stream.write(prelude.runStarted);
    await stream.write(prelude.msgStart);

    const agentRunId = await startAgentRun(
      agentRequest,
      { threadId, runId },
      signal
    );

    // Stream events from agent-ts. Retry the initial connect; mid-stream
    // reconnect would need server seq coordination, so we accept that a
    // dropped SSE connection ends the run.
    const eventsResponse = await retryingFetch(
      `${AGENTGO_URL}/runs/${agentRunId}/events`,
      {
        headers: withAgentTsAuth({ Accept: "text/event-stream" }),
        signal,
      }
    );

    if (!eventsResponse.ok) {
      throw new Error(`agent-ts events returned ${eventsResponse.status}`);
    }

    const reader = eventsResponse.body?.getReader();
    if (!reader) {
      throw new Error("No response body from agent-ts");
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let upstreamErrorMessage: string | null = null;

    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (!data || data === "[DONE]") continue;

          const event = parseAgentEvent(data);
          if (!event) continue;

          // Track text for run preview
          if (event.type === "TextMessageContent" && event.delta) {
            fullText += event.delta;
          }

          // Map to AGUI event, save to DB, publish to hub (for other consumers)
          const aguiEvent = mapAndPublishEvent(event, threadId, runId, messageId, eventState);

          // Write the AGUI event to the SSE response stream
          if (aguiEvent) {
            if (!await stream.write(aguiEvent)) break outer;
          }

          // Check for run completion. RunError must NOT fall through to
          // the post-loop finishRun path — that would overwrite the
          // error status with 'finished'.
          if (event.type === "RunFinished") {
            break outer;
          }
          if (event.type === "RunError") {
            upstreamErrorMessage = event.error?.message ?? "agent error";
            break outer;
          }
        } else if (line.startsWith("event: done")) {
          // agent-ts signals completion
          break outer;
        }
      }
    }

    reader.releaseLock();

    // Update run preview
    if (fullText) {
      updateRunPreview(runId, fullText.slice(0, 200));
    }

    if (upstreamErrorMessage !== null) {
      // Agent-ts surfaced its own RunError (most commonly "aborted" after
      // a /cancel). The event itself was already forwarded to the SSE
      // stream and hub above; here we just persist the run row state.
      errorRun(runId, upstreamErrorMessage);
    } else {
      // Emit and stream TextMessageEnd
      const msgEnd = createEvent<TextMessageEnd>("TextMessageEnd", threadId, {
        runId,
        messageId,
      });
      persistAndPublish(msgEnd);
      await stream.write(msgEnd);

      // Emit and stream RunFinished — include LLM-generated title (SURFACE.md §6.2)
      const threadRow = getThread(threadId);
      const runFinished = createEvent<RunFinished>("RunFinished", threadId, {
        runId,
        threadTitle: threadRow?.title || undefined,
      });
      finishRun(runId, 0, 0, 0);
      persistAndPublish(runFinished);
      await stream.write(runFinished);
    }

  } catch (error) {
    if (stream.isAborted) {
      // Mark the run row aborted so the SQLite ledger doesn't leave it as
      // 'running' forever when the user closes the tab or interrupts
      // before /cancel can round-trip. Idempotent with the cancel route.
      try {
        errorRun(runId, "aborted");
      } catch (dbErr) {
        raiseWarning({
          source: "chat.run-row",
          message: `failed to mark aborted run ${runId} as errored: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`,
          threadId,
          runId,
        });
      }
    } else {
      const unavailable = error instanceof AgentGoUnavailableError;
      const errMsg = unavailable
        ? `agent-ts at ${AGENTGO_URL} is unreachable (tried ${error.attempts}×). Start it with ./start-full-stack.sh or set AGENT_TS_URL.`
        : error instanceof Error
          ? error.message
          : "Unknown error";
      console.error("[Chat] agent-ts proxy error:", error);

      const runError = createEvent<RunError>("RunError", threadId, {
        runId,
        error: { message: errMsg, code: unavailable ? "AGENT_TS_UNAVAILABLE" : undefined },
      });
      errorRun(runId, errMsg);
      persistAndPublish(runError);
      await stream.write(runError);
    }
  } finally {
    await stream.close();
  }
}
