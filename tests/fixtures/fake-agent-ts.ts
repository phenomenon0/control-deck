/**
 * Fake agent-ts — a controllable in-process HTTP/SSE stand-in for the real
 * pi-agent-core runtime (apps/agent-ts, :4244). Lets route-level tests drive
 * the full `/runs` + `/runs/:id/events` wire contract without spawning a
 * process, an LLM, or a tool loop.
 *
 * Wire contract implemented (the same surface app/api/chat/route.ts speaks):
 *
 *   GET  /health                  → { status, version } (liveness probe)
 *   POST /runs                    → records the JSON body, replies { run_id }
 *   GET  /runs/:id/events         → SSE: one `data: <json>\n\n` frame per
 *                                   scripted event, in order
 *   POST /runs/:id/cancel         → marks the run cancelled; an open events
 *                                   stream then emits RunError("aborted")
 *                                   and closes (mirrors agent-ts behaviour)
 *
 * Scripting model: each POST /runs consumes one queued RunScript
 * (queueScript) or falls back to the default script (setDefaultScript).
 * Everything the fake receives is recorded (runStarts, cancels) for
 * assertions. Zero port by default — the OS assigns one; read `fake.url`.
 *
 * Example:
 *
 *   const fake = await startFakeAgentTs();
 *   fake.queueScript({
 *     events: [
 *       agt.runStarted(),
 *       agt.textStart("m1"),
 *       agt.textContent("m1", "hello"),
 *       agt.textEnd("m1"),
 *       agt.runFinished(),
 *     ],
 *   });
 *   // point code under test at fake.url (e.g. AGENT_TS_URL), drive it,
 *   // then assert on fake.runStarts[0].body
 *   await fake.stop();
 */

export type AgentTsWireEvent = { type: string; [key: string]: unknown };

export interface RunScript {
  /** Events streamed in order on GET /runs/:id/events. */
  events: AgentTsWireEvent[];
  /** Optional pause between frames (ms). Default 0. */
  eventDelayMs?: number;
  /**
   * Keep the SSE connection open after the script is exhausted instead of
   * closing it. The stream then stays open until the run is cancelled
   * (RunError "aborted" is injected first) or the fake is stopped.
   */
  holdOpen?: boolean;
  /** Status code for POST /runs. Default 200. 4xx fails fast (no retry). */
  startStatus?: number;
  /** Response body for POST /runs when startStatus !== 200. */
  startBody?: unknown;
  /**
   * Force the run_id returned by POST /runs, ignoring the request's run_id.
   * Default: echo the request body's run_id, or mint one when absent.
   */
  runIdOverride?: string;
}

export interface RecordedRunStart {
  /** The run_id the fake answered with. */
  runId: string;
  /** Parsed request JSON (null when the body was not valid JSON). */
  body: Record<string, unknown> | null;
  /** Raw request body text. */
  rawBody: string;
  /** Flattened request headers (lowercased keys). */
  headers: Record<string, string>;
  at: number;
}

export interface RecordedCancel {
  runId: string;
  at: number;
}

interface RunState {
  runId: string;
  script: RunScript;
  cancelled: boolean;
  /** Resolved when the run is cancelled (or the server stops). */
  cancelPromise: Promise<void>;
  signalCancel: () => void;
  abortedFrameSent: boolean;
}

const encoder = new TextEncoder();

function frame(event: AgentTsWireEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

function headersOf(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

/**
 * Small builders for the agent-ts wire vocabulary. All ids default to
 * stable, greppable constants so scripts stay terse.
 */
export const agt = {
  runStarted(extra: Record<string, unknown> = {}): AgentTsWireEvent {
    return { type: "RunStarted", ...extra };
  },
  llmResolved(provider = "ollama", modelId = "fake-model", extra: Record<string, unknown> = {}): AgentTsWireEvent {
    return { type: "LLMResolved", provider, modelId, label: "fake", local: true, resolveMs: 1, ...extra };
  },
  textStart(messageId = "m1", extra: Record<string, unknown> = {}): AgentTsWireEvent {
    return { type: "TextMessageStart", messageId, role: "assistant", ...extra };
  },
  textContent(messageId = "m1", delta = "", extra: Record<string, unknown> = {}): AgentTsWireEvent {
    return { type: "TextMessageContent", messageId, delta, ...extra };
  },
  textEnd(messageId = "m1", extra: Record<string, unknown> = {}): AgentTsWireEvent {
    return { type: "TextMessageEnd", messageId, ...extra };
  },
  toolCallStart(toolCallId = "tc1", toolName = "fake_tool", extra: Record<string, unknown> = {}): AgentTsWireEvent {
    return { type: "ToolCallStart", toolCallId, toolName, ...extra };
  },
  toolCallResult(toolCallId = "tc1", result: unknown = { ok: true }, success = true, extra: Record<string, unknown> = {}): AgentTsWireEvent {
    return { type: "ToolCallResult", toolCallId, result: { format: "json", data: result }, success, durationMs: 3, ...extra };
  },
  runFinished(extra: Record<string, unknown> = {}): AgentTsWireEvent {
    return { type: "RunFinished", inputTokens: 10, outputTokens: 20, costUsd: 0, ...extra };
  },
  runError(message = "agent error", extra: Record<string, unknown> = {}): AgentTsWireEvent {
    return { type: "RunError", error: { message }, ...extra };
  },
};

/** A canned happy-path script: one model turn, `deltas` of text, done. */
export function simpleTextRun(deltas: string[] = ["hello"]): RunScript {
  return {
    events: [
      agt.runStarted(),
      agt.textStart("m1"),
      ...deltas.map((d) => agt.textContent("m1", d)),
      agt.textEnd("m1"),
      agt.runFinished(),
    ],
  };
}

export class FakeAgentTs {
  url!: string;
  port!: number;

  /** Every POST /runs the fake received, in order. */
  readonly runStarts: RecordedRunStart[] = [];
  /** Every POST /runs/:id/cancel the fake received, in order. */
  readonly cancels: RecordedCancel[] = [];

  private server: ReturnType<typeof Bun.serve> | null = null;
  private queue: RunScript[] = [];
  private defaultScript: RunScript = simpleTextRun();
  private runs = new Map<string, RunState>();
  private stopped = false;

  private constructor() {}

  static async start(): Promise<FakeAgentTs> {
    const fake = new FakeAgentTs();
    const server = Bun.serve({
      port: 0, // OS-assigned; avoids colliding with a real agent-ts on :4244
      hostname: "127.0.0.1",
      fetch: (req) => fake.handle(req),
    });
    fake.server = server;
    fake.port = server.port!;
    fake.url = `http://127.0.0.1:${server.port}`;
    return fake;
  }

  /** Queue a script consumed by the next POST /runs (FIFO). */
  queueScript(script: RunScript): this {
    this.queue.push(script);
    return this;
  }

  /** Script used when the queue is empty. Defaults to a one-turn text run. */
  setDefaultScript(script: RunScript): this {
    this.defaultScript = script;
    return this;
  }

  /** Clear queued scripts and all recorded traffic. Runs in flight are left alone. */
  reset(): this {
    this.queue = [];
    this.runStarts.length = 0;
    this.cancels.length = 0;
    return this;
  }

  /** Test-side cancel trigger — equivalent to POSTing /runs/:id/cancel. */
  cancelRun(runId: string): void {
    const run = this.runs.get(runId);
    if (!run || run.cancelled) return;
    run.cancelled = true;
    run.signalCancel();
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    for (const run of this.runs.values()) {
      run.cancelled = true;
      run.signalCancel();
    }
    this.server?.stop(true); // true: immediately close in-flight connections
    this.server = null;
  }

  private nextScript(): RunScript {
    return this.queue.shift() ?? this.defaultScript;
  }

  private async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/health" && req.method === "GET") {
      return Response.json({ status: "ok", version: "fake-agent-ts" });
    }

    if (url.pathname === "/runs" && req.method === "POST") {
      const rawBody = await req.text();
      let body: Record<string, unknown> | null = null;
      try {
        body = JSON.parse(rawBody) as Record<string, unknown>;
      } catch {
        /* recorded as null below */
      }
      const script = this.nextScript();

      if (script.startStatus && script.startStatus !== 200) {
        return new Response(
          typeof script.startBody === "string"
            ? script.startBody
            : JSON.stringify(script.startBody ?? { error: `fake start failure ${script.startStatus}` }),
          { status: script.startStatus, headers: { "Content-Type": "application/json" } },
        );
      }

      const requestedRunId = typeof body?.run_id === "string" ? body.run_id : undefined;
      const runId = script.runIdOverride ?? requestedRunId ?? `fake-run-${this.runStarts.length + 1}`;

      let signalCancel!: () => void;
      const cancelPromise = new Promise<void>((resolve) => {
        signalCancel = resolve;
      });
      this.runs.set(runId, {
        runId,
        script,
        cancelled: false,
        cancelPromise,
        signalCancel,
        abortedFrameSent: false,
      });

      this.runStarts.push({ runId, body, rawBody, headers: headersOf(req), at: Date.now() });
      return Response.json({ run_id: runId });
    }

    const eventsMatch = url.pathname.match(/^\/runs\/([^/]+)\/events$/);
    if (eventsMatch && req.method === "GET") {
      const runId = decodeURIComponent(eventsMatch[1]);
      const run = this.runs.get(runId);
      if (!run) {
        return Response.json({ error: `unknown run ${runId}` }, { status: 404 });
      }
      return new Response(this.eventsStream(run, req), {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    }

    const cancelMatch = url.pathname.match(/^\/runs\/([^/]+)\/cancel$/);
    if (cancelMatch && req.method === "POST") {
      const runId = decodeURIComponent(cancelMatch[1]);
      const run = this.runs.get(runId);
      if (!run) {
        return Response.json({ error: `unknown run ${runId}` }, { status: 404 });
      }
      this.cancels.push({ runId, at: Date.now() });
      this.cancelRun(runId);
      return Response.json({ status: "cancelled", run_id: runId });
    }

    return Response.json({ error: `fake-agent-ts: no route for ${req.method} ${url.pathname}` }, { status: 404 });
  }

  /**
   * SSE body for /runs/:id/events. Pumps the script frame-by-frame; a cancel
   * at any point injects RunError("aborted") ahead of anything still queued
   * (agent-ts semantics: the deck's chat route keys its post-loop state off
   * that RunError) and then closes. A plain end-of-script just closes.
   */
  private eventsStream(run: RunState, req: Request): ReadableStream<Uint8Array> {
    const { script } = run;
    const delay = script.eventDelayMs ?? 0;
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    return new ReadableStream<Uint8Array>({
      start: async (controller) => {
        const sendAborted = () => {
          if (run.abortedFrameSent) return;
          run.abortedFrameSent = true;
          try {
            controller.enqueue(frame(agt.runError("aborted")));
          } catch {
            /* stream already closing */
          }
        };
        const close = () => {
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        };

        // Client disappeared — stop pumping.
        req.signal?.addEventListener("abort", () => close(), { once: true });

        try {
          for (const event of script.events) {
            if (run.cancelled) {
              sendAborted();
              close();
              return;
            }
            controller.enqueue(frame(event));
            if (delay > 0) {
              await Promise.race([sleep(delay), run.cancelPromise]);
            }
          }
          if (script.holdOpen && !run.cancelled) {
            await run.cancelPromise;
          }
          if (run.cancelled) sendAborted();
          close();
        } catch {
          close();
        }
      },
      cancel: () => {
        // Consumer cancelled the body — nothing to clean up beyond the flag.
        run.cancelled = true;
        run.signalCancel();
      },
    });
  }
}

/** Start a fake agent-ts on an OS-assigned port. Always `await fake.stop()` in afterAll. */
export function startFakeAgentTs(): Promise<FakeAgentTs> {
  return FakeAgentTs.start();
}
