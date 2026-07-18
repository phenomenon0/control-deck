/**
 * Run manager — owns active runs and their AbortControllers.
 *
 * In-memory only by design: agent-ts holds in-flight state for live runs
 * (pause/cancel/approve) and persists nothing. The deck (Next) is the one
 * run ledger — it saves the SSE event stream into deck.db and its boot
 * reconciliation marks runs orphaned by an agent-ts crash. Nothing here
 * survives a process restart, and that is the point.
 */

import { randomUUID } from "node:crypto";
import type { StartRunRequestWire } from "../wire.js";

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

  constructor(private readonly runner: LoopRunner) {}

  start(req: StartRunRequestWire): { runId: string; threadId: string } {
    // Honour caller-allocated run id when present (canonical AG-UI runId
    // from Next). Validate shape so a malformed id can't poison the map.
    const runId =
      typeof req.run_id === "string" && /^[A-Za-z0-9_.\-:]{1,128}$/.test(req.run_id)
        ? req.run_id
        : randomUUID();
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
