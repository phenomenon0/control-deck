/**
 * Voice (omni) lane registration — release-QA decision C1.
 *
 * The s2s stack (STT + TTS, plus an in-process LLM on some backends) was
 * the one GPU tenant the arbiter couldn't see: it loaded weights with zero
 * preflight and could OOM the box. Every deck-initiated start/restart of
 * the s2s pipeline now acquires the `omni` lane first, hard-evicting idle
 * tenants per EVICTABLE_BY policy, and the reservation is replaced (not
 * stacked) on repeated restarts.
 *
 * The estimate is deliberately coarse — the pipeline's real footprint
 * depends on the configured STT/TTS models — and env-tunable via
 * DECK_S2S_VRAM_MB. When the s2s LLM rides an external server (Ollama,
 * llama-swap) its VRAM is that lane's business, not ours.
 */

import { acquire, release } from "./arbiter";
import type { AcquireResult } from "./types";

const DEFAULT_S2S_VRAM_MB = 4096;

declare global {
  // eslint-disable-next-line no-var
  var __voiceOmniTicket: string | undefined;
}

export function s2sEstimateMb(): number {
  const raw = Number(process.env.DECK_S2S_VRAM_MB);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_S2S_VRAM_MB;
}

/** Acquire (or re-acquire) the omni lane ahead of an s2s start/restart. */
export async function acquireOmniLane(reason: string): Promise<AcquireResult> {
  const prev = globalThis.__voiceOmniTicket;
  if (prev) {
    release(prev);
    globalThis.__voiceOmniTicket = undefined;
  }
  const result = await acquire({
    lane: "omni",
    estimateMb: s2sEstimateMb(),
    reason,
    priority: "interactive",
    evicts: "hard",
  });
  if (result.status === "granted" && result.ticket) {
    globalThis.__voiceOmniTicket = result.ticket;
  }
  return result;
}
