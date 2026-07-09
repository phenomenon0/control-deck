"use client";

/**
 * Batch sweep driver — runs (fixture × preset × iteration) combinations and
 * captures a ProbeReport + raw server timing frames for each one.
 *
 * Each run is a fresh transient StreamingSttClient with its own probe so
 * timings don't bleed across runs. Optional TTS pass after the final to
 * also capture `tts.synth_per_phrase` server timings.
 */

import {
  StreamingSttClient,
  type StreamingSttOptions,
} from "@/lib/voice/streaming-stt";
import {
  StreamingTtsClient,
} from "@/lib/voice/streaming-tts";
import {
  decodeWav,
  streamWavChunks,
} from "@/lib/voice/test-harness/wav-streamer";
import {
  createProbe,
  installProbe,
  uninstallProbe,
  type ProbeReport,
} from "@/lib/voice/test-harness/latency-probe";

import type { LabKnobs, LabRun, LabTimingEvent } from "@/lib/voice-lab/store";

export interface BatchFixture {
  name: string;
  url: string;
}

export interface BatchPreset {
  name: string;
  knobs: LabKnobs;
}

export interface BatchRow {
  fixture: string;
  preset: string;
  iter: number;
  spans: Record<string, number>;
}

export interface BatchResult {
  rows: BatchRow[];
  runs: LabRun[];
}

export interface RunWavOnceOptions {
  fixture: BatchFixture;
  knobs: LabKnobs;
  /** Optional TTS prompt to follow the STT pass; uses the recognized text by default. */
  ttsPrompt?: string;
  /** Per-run timeout. Default 30000 ms. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** Build the StreamingSttOptions implied by a knob set. */
function sttOptsFromKnobs(knobs: LabKnobs, extras: Partial<StreamingSttOptions> = {}): StreamingSttOptions {
  const opts: StreamingSttOptions = {
    debug: true,
    language: knobs.stt_language ?? "en",
    ...extras,
  };
  opts.engine = knobs.stt;
  return opts;
}

/** Drive a single fixture through a fresh STT client and capture a report. */
export async function runWavOnce(opts: RunWavOnceOptions): Promise<LabRun | null> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const probe = createProbe();
  installProbe(probe);

  const events: LabTimingEvent[] = [];

  let finalText = "";
  let resolvedFinal = false;
  let settleFinal: () => void = () => {
    resolvedFinal = true;
  };
  const finalPromise = new Promise<void>((resolve) => {
    const timer = window.setTimeout(() => {
      if (!resolvedFinal) resolve();
    }, timeoutMs);
    settleFinal = () => {
      if (resolvedFinal) return;
      resolvedFinal = true;
      window.clearTimeout(timer);
      resolve();
    };
  });

  const stt = new StreamingSttClient(
    sttOptsFromKnobs(opts.knobs, {
      onFinal: (text) => {
        finalText = text;
        settleFinal();
      },
      onError: (err) => {
        console.warn("[lab/batch] stt error:", err);
        settleFinal();
      },
      onTiming: (frame) => {
        events.push({
          source: "stt",
          name: `srv_${frame.phase}`,
          t: performance.now(),
          meta: { ms: frame.ms, ...frame.meta },
        });
      },
    }),
  );

  try {
    await stt.connect();
    const res = await fetch(opts.fixture.url);
    const buf = await res.arrayBuffer();
    const info = decodeWav(buf);
    for await (const chunk of streamWavChunks(info, { realTime: false, chunkMs: 100 })) {
      stt.pushFloat32(chunk.samples, chunk.sampleRate);
    }
    stt.final();
    await finalPromise;
  } catch (err) {
    console.warn("[lab/batch] stt run failed:", err);
  } finally {
    stt.close();
  }

  // Optional TTS round-trip for downstream timings.
  const promptText = opts.ttsPrompt ?? finalText;
  if (promptText.trim()) {
    const tts = new StreamingTtsClient({
      debug: true,
      engine: opts.knobs.tts,
      voice: opts.knobs.qwen3_tts_speaker ?? opts.knobs.kokoro_voice,
      speed: opts.knobs.kokoro_speed,
      onTiming: (frame) => {
        events.push({
          source: "tts",
          name: `srv_${frame.phase}`,
          t: performance.now(),
          meta: { ms: frame.ms, ...frame.meta },
        });
      },
      onError: (err) => {
        console.warn("[lab/batch] tts error:", err);
      },
    });
    try {
      await tts.connect();
      await tts.speak({ text: promptText, speed: opts.knobs.kokoro_speed });
    } catch (err) {
      console.warn("[lab/batch] tts run failed:", err);
    } finally {
      tts.close();
    }
  }

  const report: ProbeReport = probe.report();
  uninstallProbe();

  return {
    id: `${opts.fixture.name}-${Date.now()}`,
    startedAt: Date.now(),
    knobs: opts.knobs,
    source: opts.fixture.name,
    report,
    events,
  };
}

export interface BatchSweepOptions {
  fixtures: BatchFixture[];
  presets: BatchPreset[];
  iterations: number;
  /** Per-run timeout passed through to `runWavOnce`. */
  timeoutMs?: number;
}

export async function runBatchSweep(opts: BatchSweepOptions): Promise<BatchResult> {
  const rows: BatchRow[] = [];
  const runs: LabRun[] = [];

  for (const fixture of opts.fixtures) {
    for (const preset of opts.presets) {
      for (let i = 0; i < opts.iterations; i++) {
        const run = await runWavOnce({
          fixture,
          knobs: preset.knobs,
          timeoutMs: opts.timeoutMs,
        });
        if (!run) continue;
        runs.push(run);
        rows.push({
          fixture: fixture.name,
          preset: preset.name,
          iter: i,
          spans: run.report.spans,
        });
      }
    }
  }

  return { rows, runs };
}

/** Tiny CSV exporter for the report panel. */
export function batchToCsv(result: BatchResult): string {
  const spanKeys = new Set<string>();
  for (const r of result.rows) for (const k of Object.keys(r.spans)) spanKeys.add(k);
  const headers = ["fixture", "preset", "iter", ...Array.from(spanKeys)];
  const lines = [headers.join(",")];
  for (const r of result.rows) {
    const row = [r.fixture, r.preset, String(r.iter)];
    for (const k of headers.slice(3)) row.push(formatCell(r.spans[k]));
    lines.push(row.join(","));
  }
  return lines.join("\n");
}

function formatCell(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return "";
  return v.toFixed(1);
}
