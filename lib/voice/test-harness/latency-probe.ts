/**
 * Latency probe — drop-in tracer for the voice pipeline.
 *
 * Production code calls `globalThis.__voiceProbe?.mark(name, meta)` at chosen
 * junctions (see JUNCTIONS below). The probe is undefined in production, so
 * every call site is a no-op. Tests install a probe before driving the
 * harness, drain marks via `report()`, and dump JSON / Markdown.
 *
 * Same contract for both transports:
 *   - Bun integration tests: import `createProbe`, set `globalThis.__voiceProbe`.
 *   - Playwright e2e:        `addInitScript` plants the same shape on `window`.
 *
 * The reducer that turns marks into deltas is shared so reports are
 * comparable across both layers.
 */

export interface Mark {
  name: string;
  t: number;
  meta?: Record<string, unknown>;
}

export interface ProbeReport {
  startedAt: number;
  marks: Mark[];
  /** Deltas from the chosen baseline mark to every later mark, in ms. */
  deltas: Record<string, number>;
  /** Pairwise "named span" deltas (e.g. ws_open → stt_partial_first). */
  spans: Record<string, number>;
}

export interface Probe {
  mark(name: string, meta?: Record<string, unknown>): void;
  reset(): void;
  marks(): readonly Mark[];
  report(opts?: { baseline?: string }): ProbeReport;
}

/** Canonical junction names. Keep in sync with call sites. */
export const JUNCTIONS = {
  CHUNK_FIRST: "chunk_first",
  CHUNK_LAST: "chunk_last",
  WS_OPEN: "ws_open",
  STT_READY: "stt_ready",
  STT_PARTIAL_FIRST: "stt_partial_first",
  STT_PARTIAL: "stt_partial",
  STT_FINAL: "stt_final",
  SESSION_PARTIAL_DISPATCHED: "session_partial_dispatched",
  SESSION_FINAL_DISPATCHED: "session_final_dispatched",
  LIVE_TEXT_PAINTED: "live_text_painted",
  DOC_BLOCK_APPENDED: "doc_block_appended",
  // Multi-turn loop: first byte of assistant audio, plus FSM entry/exit
  // for `speaking`. Together they bracket the full mic-stop → audible-reply
  // window and let an e2e harness verify the mic was NOT re-opened during
  // that window.
  TTS_FIRST_CHUNK: "tts_first_chunk",
  TTS_LAST_CHUNK: "tts_last_chunk",
  TTS_REQUEST_SENT: "tts_request_sent",
  AUDIO_STARTED: "audio_started",
  AUDIO_STOPPED: "audio_stopped",
  // LLM legs — POST sent, first streamed token, last token.
  LLM_REQUEST_SENT: "llm_request_sent",
  LLM_FIRST_TOKEN: "llm_first_token",
  LLM_LAST_TOKEN: "llm_last_token",
  // VAD junctions — the "response gap" the user explicitly named. Fired by
  // AgentInput on Silero callbacks so the lab can plot speech-end → stt-final
  // (the dead air that makes chat feel "broken").
  VAD_SPEECH_START: "vad_speech_start",
  VAD_SPEECH_END: "vad_speech_end",
  // s2s/OpenAI-Realtime-compatible junctions observable in the browser.
  REALTIME_SPEECH_STARTED: "realtime_speech_started",
  REALTIME_SPEECH_STOPPED: "realtime_speech_stopped",
  REALTIME_TRANSCRIPT_DELTA: "realtime_transcript_delta",
  REALTIME_TRANSCRIPT_FINAL: "realtime_transcript_final",
  REALTIME_RESPONSE_CREATED: "realtime_response_created",
  REALTIME_FIRST_AUDIO: "realtime_first_audio",
  REALTIME_RESPONSE_DONE: "realtime_response_done",
  // Server-emitted timing frames (via ?debug=timing). The probe surfaces them
  // as marks named "srv_<phase>" so spans can pair them with client marks.
  SRV_STT_INFERENCE: "srv_stt.inference",
  SRV_VAD_FRAME: "srv_vad.frame_inference",
  SRV_TTS_FIRST_CHUNK: "srv_tts.first_chunk_emit",
  SRV_TTS_END: "srv_tts.end_emit",
} as const;

/**
 * Spans we always compute when both endpoints fired.
 * Each tuple is [name, from-mark, to-mark]; values are signed if from > to.
 * Order in this list controls the order rendered in the Markdown report.
 */
const STANDARD_SPANS: Array<[string, string, string]> = [
  ["stt_warmup", JUNCTIONS.WS_OPEN, JUNCTIONS.STT_READY],
  ["stt_ttft", JUNCTIONS.CHUNK_FIRST, JUNCTIONS.STT_PARTIAL_FIRST],
  ["stt_final_after_first_chunk", JUNCTIONS.CHUNK_FIRST, JUNCTIONS.STT_FINAL],
  ["stt_final_after_last_chunk", JUNCTIONS.CHUNK_LAST, JUNCTIONS.STT_FINAL],
  ["session_propagation", JUNCTIONS.STT_FINAL, JUNCTIONS.SESSION_FINAL_DISPATCHED],
  ["live_text_render", JUNCTIONS.STT_PARTIAL_FIRST, JUNCTIONS.LIVE_TEXT_PAINTED],
  ["doc_append_after_final", JUNCTIONS.STT_FINAL, JUNCTIONS.DOC_BLOCK_APPENDED],
  ["e2e_first_word_to_doc", JUNCTIONS.CHUNK_FIRST, JUNCTIONS.DOC_BLOCK_APPENDED],
  ["mic_stop_to_first_audio", JUNCTIONS.STT_FINAL, JUNCTIONS.TTS_FIRST_CHUNK],
  ["tts_to_speaker", JUNCTIONS.TTS_FIRST_CHUNK, JUNCTIONS.AUDIO_STARTED],
  ["e2e_turn_latency", JUNCTIONS.CHUNK_FIRST, JUNCTIONS.AUDIO_STOPPED],
  // E2E voice-turn legs — measured by the run-e2e harness (STT → LLM → TTS).
  ["stt_to_llm", JUNCTIONS.STT_FINAL, JUNCTIONS.LLM_REQUEST_SENT],
  ["llm_ttft", JUNCTIONS.LLM_REQUEST_SENT, JUNCTIONS.LLM_FIRST_TOKEN],
  ["llm_total", JUNCTIONS.LLM_REQUEST_SENT, JUNCTIONS.LLM_LAST_TOKEN],
  ["llm_to_tts", JUNCTIONS.LLM_LAST_TOKEN, JUNCTIONS.TTS_REQUEST_SENT],
  ["tts_ttft", JUNCTIONS.TTS_REQUEST_SENT, JUNCTIONS.TTS_FIRST_CHUNK],
  ["tts_total", JUNCTIONS.TTS_REQUEST_SENT, JUNCTIONS.TTS_LAST_CHUNK],
  ["e2e_voice_turn", JUNCTIONS.CHUNK_FIRST, JUNCTIONS.TTS_LAST_CHUNK],
  // VAD response gap — the dead air between user finishing speaking and the
  // STT pipeline producing a final transcript.
  ["vad_to_stt_final", JUNCTIONS.VAD_SPEECH_END, JUNCTIONS.STT_FINAL],
  ["vad_speech_duration", JUNCTIONS.VAD_SPEECH_START, JUNCTIONS.VAD_SPEECH_END],
  // s2s realtime path: only client-observable protocol events are available.
  ["speech_stop_to_transcript_final", JUNCTIONS.REALTIME_SPEECH_STOPPED, JUNCTIONS.REALTIME_TRANSCRIPT_FINAL],
  ["transcript_final_to_response_created", JUNCTIONS.REALTIME_TRANSCRIPT_FINAL, JUNCTIONS.REALTIME_RESPONSE_CREATED],
  ["response_created_to_first_audio", JUNCTIONS.REALTIME_RESPONSE_CREATED, JUNCTIONS.REALTIME_FIRST_AUDIO],
  ["speech_stop_to_first_audio", JUNCTIONS.REALTIME_SPEECH_STOPPED, JUNCTIONS.REALTIME_FIRST_AUDIO],
  // Server-vs-client splits — if (srv_stt.inference) << (stt_ttft) then the
  // gap is wire/scheduling, not the model.
  ["stt_wire_overhead", JUNCTIONS.SRV_STT_INFERENCE, JUNCTIONS.STT_PARTIAL_FIRST],
  ["tts_wire_overhead", JUNCTIONS.SRV_TTS_FIRST_CHUNK, JUNCTIONS.TTS_FIRST_CHUNK],
];

export interface CreateProbeOptions {
  /** Fired on every mark, in addition to the internal buffer. Used by the
   * call lab to react to junctions in real time. */
  onMark?: (mark: Mark) => void;
}

export function createProbe(opts: CreateProbeOptions = {}): Probe {
  const startedAt = nowMs();
  const marks: Mark[] = [];
  return {
    mark(name, meta) {
      const m = { name, t: nowMs() - startedAt, meta };
      marks.push(m);
      opts.onMark?.(m);
    },
    reset() {
      marks.length = 0;
    },
    marks() {
      return marks;
    },
    report(opts = {}) {
      return reportFromMarks(marks, { startedAt, baseline: opts.baseline });
    },
  };
}

export function reportFromMarks(
  marks: readonly Mark[],
  opts: { startedAt?: number; baseline?: string } = {},
): ProbeReport {
  const baseline = opts.baseline ?? JUNCTIONS.CHUNK_FIRST;
  const baseMark = firstMark(marks, baseline);
  const deltas: Record<string, number> = {};
  if (baseMark) {
    for (const m of marks) {
      if (m === baseMark) continue;
      const key = `${m.name}_after_${baseline}`;
      if (deltas[key] === undefined) deltas[key] = m.t - baseMark.t;
    }
  }
  const spans: Record<string, number> = {};
  for (const [key, from, to] of STANDARD_SPANS) {
    const a = firstMark(marks, from);
    const b = firstMark(marks, to);
    if (a && b) spans[key] = b.t - a.t;
  }
  return { startedAt: opts.startedAt ?? nowMs(), marks: [...marks], deltas, spans };
}

function firstMark(marks: readonly Mark[], name: string): Mark | undefined {
  for (const m of marks) if (m.name === name) return m;
  return undefined;
}

function nowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") return performance.now();
  return Date.now();
}

/** Aggregate spans across N runs. p50/p95/mean per span, ignoring missing values. */
export function aggregateReports(reports: ProbeReport[]): {
  count: number;
  byKey: Record<string, { count: number; mean: number; p50: number; p95: number; min: number; max: number }>;
} {
  const byKey: Record<string, number[]> = {};
  for (const r of reports) {
    for (const [k, v] of Object.entries(r.spans)) {
      if (!Number.isFinite(v)) continue;
      (byKey[k] ??= []).push(v);
    }
  }
  const out: ReturnType<typeof aggregateReports>["byKey"] = {};
  for (const [k, values] of Object.entries(byKey)) {
    values.sort((a, b) => a - b);
    const sum = values.reduce((s, v) => s + v, 0);
    out[k] = {
      count: values.length,
      mean: sum / values.length,
      p50: percentile(values, 0.5),
      p95: percentile(values, 0.95),
      min: values[0],
      max: values[values.length - 1],
    };
  }
  return { count: reports.length, byKey: out };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)));
  return sorted[idx];
}

/**
 * Install this probe as `globalThis.__voiceProbe`. Production declares the
 * global as a minimal `{ mark }` shape (see `lib/voice/streaming-stt.ts`); a
 * full `Probe` object is structurally compatible with it.
 */
export function installProbe(probe: Probe): void {
  (globalThis as { __voiceProbe?: Probe }).__voiceProbe = probe;
}

export function uninstallProbe(): void {
  delete (globalThis as { __voiceProbe?: Probe }).__voiceProbe;
}
