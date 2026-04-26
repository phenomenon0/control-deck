/**
 * Run manager — owns active runs and their AbortControllers. The actual
 * agent loop wiring (pi-agent-core) lands in Task #8 via `startAgentLoop`.
 *
 * For Task #7 the manager just allocates run ids and exposes the cancel hook;
 * the loop runner is injected at construction so we can stub it during the
 * skeleton phase and swap in the real implementation later without touching
 * the HTTP layer.
 */

import { randomUUID } from "node:crypto";
import type { StartRunRequestWire } from "../wire.js";
import type { RunStore } from "./store.js";

export interface RunHandle {
  runId: string;
  threadId: string;
  controller: AbortController;
  startedAt: string;
  status: "running" | "paused" | "paused_requested";
}

export type LoopRunner = (
  handle: RunHandle,
  req: StartRunRequestWire,
  signal: AbortSignal,
) => Promise<void>;

export class RunManager {
  private readonly runs = new Map<string, RunHandle>();

  constructor(
    private readonly runner: LoopRunner,
    private readonly store?: RunStore,
  ) {}

  start(req: StartRunRequestWire): { runId: string; threadId: string } {
    const runId = randomUUID();
    const threadId = req.thread_id ?? randomUUID();
    const controller = new AbortController();
    const startedAt = new Date().toISOString();
    const handle: RunHandle = {
      runId,
      threadId,
      controller,
      startedAt,
      status: "running",
    };
    this.runs.set(runId, handle);

    if (this.store) {
      try {
        this.store.startRun({
          runId,
          threadId,
          model: req.llm?.model,
          startedAt,
        });
      } catch (err) {
        console.error("[runs] startRun persistence failed:", err);
      }
    }

    queueMicrotask(() => {
      this.runner(handle, req, controller.signal).finally(() => {
        this.runs.delete(runId);
      });
    });

    return { runId, threadId };
  }

  cancel(runId: string): boolean {
    const handle = this.runs.get(runId);
    if (!handle) return false;
    handle.controller.abort();
    return true;
  }

  pause(runId: string): boolean {
    const handle = this.runs.get(runId);
    if (!handle) return false;
    handle.status = "paused_requested";
    return true;
  }

  resume(runId: string): boolean {
    const handle = this.runs.get(runId);
    if (!handle) return false;
    handle.status = "running";
    return true;
  }

  get(runId: string): RunHandle | undefined {
    return this.runs.get(runId);
  }

  size(): number {
    return this.runs.size;
  }
}
