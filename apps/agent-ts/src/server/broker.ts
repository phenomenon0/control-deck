/**
 * Approval broker — pause `beforeToolCall` until an external POST
 * /runs/:id/approve|reject lands.
 *
 * Mirrors `core.ApprovalBroker` semantics: each pending request has an id,
 * approve/reject by id (or "any pending for run" if id omitted).
 */

import { randomUUID } from "node:crypto";

export type RiskLevel = "low" | "medium" | "high";

export interface PendingApproval {
  requestId: string;
  runId: string;
  toolName: string;
  toolCallId: string;
  args: unknown;
  description?: string;
  riskLevel: RiskLevel;
  createdAt: string;
}

interface PendingInternal extends PendingApproval {
  resolve: (value: { approved: boolean; reason?: string }) => void;
}

export class ApprovalBroker {
  private readonly byRequest = new Map<string, PendingInternal>();
  private readonly byRun = new Map<string, Set<string>>();

  /**
   * Register a pending approval and return its id alongside a promise that
   * resolves when {@link approve}/{@link reject} is called.
   *
   * Splitting create from await lets callers emit `InterruptRequested` with
   * the request id before they block.
   */
  create(input: {
    runId: string;
    toolName: string;
    toolCallId: string;
    args: unknown;
    description?: string;
    riskLevel?: RiskLevel;
    signal?: AbortSignal;
  }): {
    requestId: string;
    promise: Promise<{ approved: boolean; reason?: string; requestId: string }>;
  } {
    const requestId = randomUUID();
    const promise = new Promise<{ approved: boolean; reason?: string; requestId: string }>(
      (resolve, reject) => {
        const entry: PendingInternal = {
          requestId,
          runId: input.runId,
          toolName: input.toolName,
          toolCallId: input.toolCallId,
          args: input.args,
          description: input.description,
          riskLevel: input.riskLevel ?? "medium",
          createdAt: new Date().toISOString(),
          resolve: ({ approved, reason }) => {
            this.cleanup(requestId);
            resolve({ approved, reason, requestId });
          },
        };
        this.byRequest.set(requestId, entry);
        let runSet = this.byRun.get(input.runId);
        if (!runSet) {
          runSet = new Set();
          this.byRun.set(input.runId, runSet);
        }
        runSet.add(requestId);

        if (input.signal) {
          if (input.signal.aborted) {
            this.cleanup(requestId);
            reject(new Error("aborted"));
            return;
          }
          input.signal.addEventListener(
            "abort",
            () => {
              this.cleanup(requestId);
              reject(new Error("aborted"));
            },
            { once: true },
          );
        }
      },
    );
    return { requestId, promise };
  }

  approve(requestId: string): boolean {
    const entry = this.byRequest.get(requestId);
    if (!entry) return false;
    entry.resolve({ approved: true });
    return true;
  }

  reject(requestId: string, reason?: string): boolean {
    const entry = this.byRequest.get(requestId);
    if (!entry) return false;
    entry.resolve({ approved: false, reason });
    return true;
  }

  pendingForRun(runId: string): PendingApproval[] {
    const ids = this.byRun.get(runId);
    if (!ids) return [];
    const out: PendingApproval[] = [];
    for (const id of ids) {
      const entry = this.byRequest.get(id);
      if (entry) {
        const { resolve: _resolve, ...pub } = entry;
        out.push(pub);
      }
    }
    return out;
  }

  stats(): { pending_requests: number; active_runs: number } {
    return {
      pending_requests: this.byRequest.size,
      active_runs: this.byRun.size,
    };
  }

  private cleanup(requestId: string) {
    const entry = this.byRequest.get(requestId);
    if (!entry) return;
    this.byRequest.delete(requestId);
    const runSet = this.byRun.get(entry.runId);
    if (runSet) {
      runSet.delete(requestId);
      if (runSet.size === 0) this.byRun.delete(entry.runId);
    }
  }
}
