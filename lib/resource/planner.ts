/**
 * Decomposition planner — runs a sequence of GPU steps through the arbiter.
 *
 * A "plan" is a list of `PlanStep`s. Each step claims a lane, runs work,
 * then releases. The arbiter handles eviction between steps automatically:
 * if step 1 holds the chat lane and step 2 needs the 3d lane, the chat
 * reservation is `restoreOnIdle`-flagged so it comes back after step 2.
 *
 * Sequential execution is the safe default — running steps in parallel
 * would just deadlock against the same VRAM. If a caller wants concurrency
 * they should split the plan, mark heavy lanes `evicts:"hard"`, and live
 * with the chat downgrade.
 */

import { acquire, release, touch } from "./arbiter";
import type { AcquirePriority, EvictMode, LaneId } from "./types";

export interface PlanStep<T = unknown> {
  /** Lane this step wants to occupy while it runs. */
  lane: LaneId;
  /** VRAM estimate in MB. Caller computes via lib/hardware/vram.ts. */
  estimateMb: number;
  /** Why this step exists. Shown in the ResourcePane. */
  reason: string;
  /** Step body. The arbiter has already granted the lane when this fires. */
  run: (ctx: PlanStepContext) => Promise<T>;
  /** Optional swap-target model id (e.g. `qwen3.5-35b`). */
  modelId?: string;
  /** Defaults to `normal`. */
  priority?: AcquirePriority;
  /**
   * Defaults to `hard` — steps in a plan are expected to ride over each
   * other. Switch to `soft` for opportunistic background work.
   */
  evicts?: EvictMode;
  /** TTL keepalive for long-running steps; pass through to acquire. */
  ttlMs?: number;
  /** Restore this step's reservation when a heavier step lets go. */
  restoreOnIdle?: boolean;
  /** Friendly label for logs and telemetry. */
  label?: string;
}

export interface PlanStepContext {
  ticket: string;
  /** Bumps the reservation's lastTouchAt so a TTL doesn't reap mid-run. */
  keepalive(): void;
}

export type PlanStepStatus = "ok" | "denied" | "failed" | "skipped";

export interface PlanStepResult<T = unknown> {
  label: string;
  lane: LaneId;
  status: PlanStepStatus;
  value?: T;
  error?: string;
  durationMs: number;
}

export interface PlanResult {
  ok: boolean;
  steps: PlanStepResult[];
}

export interface PlanOptions {
  /** Stop after the first non-ok step. Default true. */
  stopOnFailure?: boolean;
}

/**
 * Run a plan top-to-bottom. Returns one result per step.
 *
 * Per-step semantics:
 *   - acquire() fails (`denied`) → step is `denied`, remaining steps may
 *     be skipped depending on stopOnFailure.
 *   - `run` throws → step is `failed`, reservation is still released.
 *   - `run` returns → step is `ok`, value carried in result.
 */
export async function runPlan<T = unknown>(
  steps: PlanStep<T>[],
  options: PlanOptions = {},
): Promise<PlanResult> {
  const stopOnFailure = options.stopOnFailure ?? true;
  const out: PlanStepResult[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const label = step.label ?? `${step.lane}#${i}`;
    const t0 = Date.now();

    const acq = await acquire({
      lane: step.lane,
      estimateMb: step.estimateMb,
      reason: `[plan] ${step.reason}`,
      modelId: step.modelId,
      priority: step.priority ?? "normal",
      evicts: step.evicts ?? "hard",
      ttlMs: step.ttlMs,
      restoreOnIdle: step.restoreOnIdle ?? false,
    });

    if (acq.status !== "granted" || !acq.ticket) {
      out.push({
        label,
        lane: step.lane,
        status: "denied",
        error: acq.reason,
        durationMs: Date.now() - t0,
      });
      if (stopOnFailure) {
        for (let j = i + 1; j < steps.length; j++) {
          const s = steps[j];
          out.push({
            label: s.label ?? `${s.lane}#${j}`,
            lane: s.lane,
            status: "skipped",
            durationMs: 0,
          });
        }
        return { ok: false, steps: out };
      }
      continue;
    }

    const ticket = acq.ticket;
    try {
      const value = await step.run({
        ticket,
        keepalive: () => {
          touch(ticket);
        },
      });
      out.push({
        label,
        lane: step.lane,
        status: "ok",
        value,
        durationMs: Date.now() - t0,
      });
    } catch (err) {
      out.push({
        label,
        lane: step.lane,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - t0,
      });
      if (stopOnFailure) {
        release(ticket);
        for (let j = i + 1; j < steps.length; j++) {
          const s = steps[j];
          out.push({
            label: s.label ?? `${s.lane}#${j}`,
            lane: s.lane,
            status: "skipped",
            durationMs: 0,
          });
        }
        return { ok: false, steps: out };
      }
    } finally {
      release(ticket);
    }
  }

  const ok = out.every((r) => r.status === "ok");
  return { ok, steps: out };
}
