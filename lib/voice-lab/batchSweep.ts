"use client";

/**
 * Batch sweep driver — runs (fixture × preset × iteration) combinations and
 * captures a ProbeReport + raw server timing frames for each one.
 *
 * Each run posts the fixture through the app-gateway voice endpoints with its
 * own probe so timings don't bleed across runs. Optional TTS pass after the
 * final confirms the active TTS route can synthesize the recognized text.
 */

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

/** Drive a single fixture through the active app voice routes and capture a report. */
export async function runWavOnce(opts: RunWavOnceOptions): Promise<LabRun | null> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const probe = createProbe();
  installProbe(probe);

  const events: LabTimingEvent[] = [];

  let finalText = "";
  try {
    const res = await fetch(opts.fixture.url);
    const buf = await res.arrayBuffer();
    const form = new FormData();
    form.append("audio", new Blob([buf], { type: "audio/wav" }), "fixture.wav");
    form.append("mimeType", "audio/wav");
    if (opts.knobs.stt_language) form.append("language", opts.knobs.stt_language);
    const sttRes = await fetch("/api/voice/stt", {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (sttRes.ok) {
      const data = (await sttRes.json()) as { text?: string };
      finalText = data.text ?? "";
    } else {
      console.warn("[lab/batch] stt route failed:", await sttRes.text().catch(() => sttRes.statusText));
    }
  } catch (err) {
    console.warn("[lab/batch] stt run failed:", err);
  }

  // Optional TTS round-trip for downstream timings.
  const promptText = opts.ttsPrompt ?? finalText;
  if (promptText.trim()) {
    try {
      const ttsRes = await fetch("/api/voice/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: promptText,
          voice: opts.knobs.qwen3_tts_speaker ?? opts.knobs.kokoro_voice,
          speed: opts.knobs.kokoro_speed,
          format: "wav",
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!ttsRes.ok) {
        console.warn("[lab/batch] tts route failed:", await ttsRes.text().catch(() => ttsRes.statusText));
      }
    } catch (err) {
      console.warn("[lab/batch] tts run failed:", err);
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
