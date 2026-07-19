/**
 * agent-ts event-stream consumption for POST /api/chat.
 *
 * Background proxy loop: write the locally pre-emitted prelude, start the
 * agent-ts run, then forward every upstream event (mapped to AG-UI,
 * persisted, republished) into the client-facing SSE stream.
 *
 * Terminal state machine — the deck guarantees every run ends with EXACTLY
 * ONE terminal event (RunFinished XOR RunError) on the wire:
 *   - Upstream RunFinished → forwarded (enriched with the thread title) and
 *     it IS the terminal; post-loop only persists the run row, no second
 *     terminal event is minted.
 *   - Upstream RunError → forwarded as the terminal; run row 'error' (never
 *     overwritten by finishRun).
 *   - Silent FIN (stream ends or `event: done` with no terminal) → the deck
 *     mints the one canonical RunFinished. This guard is load-bearing: a
 *     run ALWAYS terminates exactly once even if agent-ts goes quiet.
 *   - Transport/agent-ts failure → deck-minted RunError, run row 'error'.
 *   - Client abort → run row marked "aborted", no further events.
 *
 * The deck pre-emits a TextMessageStart under its own messageId before
 * upstream connects. That segment stays open until an upstream
 * TextMessageEnd targets the same id; if it is still open when the run
 * terminates, the deck mints the matching TextMessageEnd immediately
 * BEFORE the terminal event — on the error path too — so the UI never
 * keeps a dangling streaming segment.
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
  mapAgentEvent,
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
  // Track per-stream state used by mapAgentEvent — currently tells us
  // whether to suppress the first TextMessageStart from agent-ts (the deck
  // pre-emitted one locally) vs forwarding the ones that begin each model
  // turn after a tool-call round.
  const eventState = { sawFirstTextStart: false };

  // Terminal bookkeeping (see header). `terminalKind` records the upstream
  // terminal once forwarded so the post-loop path persists ledger state
  // only and never re-emits it; `localTextOpen` tracks the deck's
  // pre-emitted TextMessageStart.
  let terminalKind: "finished" | "error" | null = null;
  let localTextOpen = true;

  /**
   * Mint + persist + stream the TextMessageEnd closing the deck's
   * pre-emitted segment, at most once. Called immediately before whatever
   * terminal event ends the run (forwarded or minted).
   */
  const closeLocalText = async (): Promise<void> => {
    if (!localTextOpen) return;
    localTextOpen = false;
    const msgEnd = createEvent<TextMessageEnd>("TextMessageEnd", threadId, {
      runId,
      messageId,
    });
    persistAndPublish(msgEnd);
    await stream.write(msgEnd);
  };

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

          // Map to AGUI event, then persist + publish + forward it.
          const aguiEvent = mapAgentEvent(event, threadId, runId, messageId, eventState);
          if (aguiEvent) {
            // The forwarded upstream RunFinished is the one canonical
            // terminal — enrich it with the thread title so the SURFACE.md
            // §6.2 title flow (previously carried by the deck-minted second
            // RunFinished, removed as a duplicate) keeps working.
            if (aguiEvent.type === "RunFinished") {
              const title = getThread(threadId)?.title;
              if (title) (aguiEvent as RunFinished).threadTitle = title;
            }

            persistAndPublish(aguiEvent);

            // An upstream TextMessageEnd addressed to the deck's messageId
            // closes the pre-emitted segment — nothing left to mint later.
            if (
              aguiEvent.type === "TextMessageEnd" &&
              (aguiEvent as TextMessageEnd).messageId === messageId
            ) {
              localTextOpen = false;
            }

            // A terminal event ends every open text segment: close the
            // deck's pre-emitted start BEFORE the terminal hits the wire.
            if (aguiEvent.type === "RunFinished" || aguiEvent.type === "RunError") {
              await closeLocalText();
            }

            // Write the AGUI event to the SSE response stream
            if (!await stream.write(aguiEvent)) break outer;
          }

          // Check for run completion. RunError must NOT fall through to
          // the post-loop finishRun path — that would overwrite the
          // error status with 'finished'.
          if (event.type === "RunFinished") {
            terminalKind = "finished";
            break outer;
          }
          if (event.type === "RunError") {
            terminalKind = "error";
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

    if (terminalKind === "error") {
      // Agent-ts surfaced its own RunError (most commonly "aborted" after
      // a /cancel). The event itself was already forwarded to the SSE
      // stream and hub above; here we just persist the run row state.
      errorRun(runId, upstreamErrorMessage ?? "agent error");
    } else if (terminalKind === "finished") {
      // The forwarded RunFinished was the terminal event — persist the
      // ledger transition only. Minting a second one here used to put two
      // RunFinished events on the wire for a single run.
      finishRun(runId, 0, 0, 0);
    } else {
      // Silent-FIN guard: the stream ended (or `event: done` arrived)
      // without any upstream terminal event. The deck mints the one
      // canonical RunFinished so a run ALWAYS terminates exactly once —
      // include the LLM-generated title (SURFACE.md §6.2).
      await closeLocalText();
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

      // Close the pre-emitted text segment before the terminal error so
      // the UI isn't left with a dangling streaming segment.
      await closeLocalText();

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
