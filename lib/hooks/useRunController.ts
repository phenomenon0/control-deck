/**
 * lib/hooks/useRunController.ts — the ONE client-side owner of the active
 * agent run id and of run cancellation (Phase 3, T3-cancel).
 *
 * Before this module, `useAgentRun.stop()` and `use-voice-session.interrupt()`
 * each tracked their own run id and each POSTed `/api/chat/runs/:id/cancel`,
 * so a single user gesture could cancel the same run twice. Now both hooks
 * share one controller (ChatSurface passes its instance down; standalone
 * consumers get a private default), and every cancel routes through a
 * client-wide ledger that guarantees exactly one POST per run id — even when
 * two controller instances (e.g. a shared upstream voice session and a local
 * chat run) race to cancel the same run.
 *
 * The controller is transport-agnostic: aborting the in-flight fetch stays
 * with the hook that owns the fetch. This owns only *who the active run is*
 * and *that its cancel is posted once*.
 *
 * `createRunController` is the pure, React-free core (unit-tested directly);
 * `useRunController` is the hook facade returning one stable instance.
 */

import { useRef } from "react";

/**
 * Who registered the active run:
 * - `"chat"` — `useAgentRun.send` started it via POST /api/chat.
 * - `"chat-surface"` — the voice bridge (`markAgentRunStarted`) marked a run
 *   owned by the chat surface; the agui stream must not finish it.
 * - `"sse"` — observed on `/api/agui/stream` (started elsewhere, e.g. an
 *   agent-ts run); the stream that announced it may also finish it.
 */
export type RunSource = "chat" | "chat-surface" | "sse";

export interface RunController {
  /** Active run id, or null when no run is in flight. Always current. */
  peekRunId(): string | null;
  /** Source that registered the active run. */
  peekSource(): RunSource | null;
  /** Whether a run is currently registered. */
  isActive(): boolean;
  /**
   * Register the active run. Re-announcing the same run id keeps the existing
   * source unless an owned source replaces a passive one: an `"sse"` sighting
   * never downgrades a run the deck itself started, while `"chat"` /
   * `"chat-surface"` marks upgrade an `"sse"` sighting. Passing `null` retags
   * the current run's source without changing its id (voice bridge with no
   * id of its own).
   */
  begin(runId: string | null, source: RunSource): void;
  /**
   * Clear the active run. With `runId`, only clears when it matches the
   * active id; with `onlySource`, only when the source also matches (the agui
   * stream may finish only runs it announced). Returns whether it cleared.
   */
  finish(runId?: string, opts?: { onlySource?: RunSource }): boolean;
  /**
   * Cancel the active run: clears it synchronously and POSTs
   * `/api/chat/runs/:id/cancel` exactly once per run id, client-wide.
   * Returns the cancelled run id, or null when no run was active.
   */
  cancel(): string | null;
}

/**
 * Client-wide ledger of run ids whose cancel was already POSTed. Run ids are
 * per-run UUIDs, so membership is permanent for practical purposes; the cap
 * just bounds memory on very long sessions (oldest half is dropped, which can
 * only ever risk a duplicate cancel for a run cancelled hundreds of runs ago).
 */
const CANCEL_LEDGER_MAX = 512;
const cancelledRunIds = new Set<string>();

function postCancelOnce(runId: string): void {
  if (cancelledRunIds.has(runId)) return;
  cancelledRunIds.add(runId);
  if (cancelledRunIds.size > CANCEL_LEDGER_MAX) {
    let drop = CANCEL_LEDGER_MAX / 2;
    for (const id of cancelledRunIds) {
      cancelledRunIds.delete(id);
      if (--drop <= 0) break;
    }
  }
  void fetch(`/api/chat/runs/${encodeURIComponent(runId)}/cancel`, {
    method: "POST",
    keepalive: true,
  }).catch(() => {
    /* best-effort: the local stream abort is what stops the UI */
  });
}

/** Pure controller core — no React, directly unit-testable. */
export function createRunController(): RunController {
  let active: { runId: string; source: RunSource } | null = null;

  return {
    peekRunId: () => active?.runId ?? null,
    peekSource: () => active?.source ?? null,
    isActive: () => active !== null,

    begin(runId, source) {
      if (!runId) {
        if (active && active.source !== source) active = { ...active, source };
        return;
      }
      if (active?.runId === runId) {
        if (source !== "sse" && active.source !== source) {
          active = { runId, source };
        }
        return;
      }
      active = { runId, source };
    },

    finish(runId, opts) {
      if (!active) return false;
      if (runId !== undefined && active.runId !== runId) return false;
      if (opts?.onlySource && active.source !== opts.onlySource) return false;
      active = null;
      return true;
    },

    cancel() {
      if (!active) return null;
      const { runId } = active;
      active = null;
      postCancelOnce(runId);
      return runId;
    },
  };
}

/**
 * Hook facade: one stable controller instance per component instance.
 * Pass it down to `useAgentRun` and `useVoiceSession` so chat and voice
 * share run ownership; either hook falls back to a private controller when
 * none is provided.
 */
export function useRunController(): RunController {
  const ref = useRef<RunController | null>(null);
  if (!ref.current) ref.current = createRunController();
  return ref.current;
}
