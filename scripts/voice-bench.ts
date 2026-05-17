#!/usr/bin/env bun
/**
 * voice-bench — focused benchmark for the voice flow.
 *
 *   bun scripts/voice-bench.ts             # default: TTS streaming TTFA + voices
 *   bun scripts/voice-bench.ts --skip-stt  # TTS-only
 *   bun scripts/voice-bench.ts --runs 3    # 3 trials per phrase
 *
 * Measures the bits not already covered by tests/voice-harness/run-batch.ts:
 *   - GET /voices works and the active TTS engine lists at least one voice
 *   - Streaming TTS time-to-first-chunk per phrase length bucket
 *   - Streaming TTS end-to-end duration
 *
 * STT TTFA + final latency are already benched by run-batch.ts; we re-invoke
 * its single-run path against the bundled test WAVs to keep one report.
 *
 * Output: artifacts/voice-bench/<timestamp>/{report.json,report.md}
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, basename } from "node:path";
import { Glob } from "bun";

import { StreamingTtsClient } from "@/lib/voice/streaming-tts";
import {
  ensureVoiceCore,
  stopVoiceCore,
  type VoiceCoreHandle,
} from "@/lib/voice/test-harness/voice-core-fixture";
import { runSttOnce } from "../tests/voice-harness/lib/run-stt-once";

interface CliArgs {
  runs: number;
  skipStt: boolean;
  skipTts: boolean;
  wavGlob: string;
  ttsEngine?: string;
  voice?: string;
}

interface TtsTrial {
  phrase: string;
  phraseChars: number;
  ttfaMs: number | null;
  totalMs: number;
  chunkCount: number;
  totalPcmBytes: number;
  sampleRate: number;
  ok: boolean;
  error?: string;
}

interface VoicesProbe {
  ok: boolean;
  engine?: string;
  voiceCount?: number;
  sampleVoiceIds?: string[];
  error?: string;
}

interface SttTrial {
  wav: string;
  ok: boolean;
  finalText?: string;
  ttfaMs?: number;
  finalMs?: number;
  error?: string;
}

const PHRASES = [
  "Hi.",
  "Sure, let me check that for you.",
  "Here is a short summary of what I found in the documentation.",
  "The streaming pipeline emits phrases as soon as the underlying engine finishes synthesizing them, which keeps time to first audio low even on longer turns.",
];

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);
  const out: CliArgs = {
    runs: 2,
    skipStt: false,
    skipTts: false,
    wavGlob: "models/voice-engines/sherpa-streaming/test_wavs/*.wav",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--runs") out.runs = Number(argv[++i] ?? "2");
    else if (a === "--skip-stt") out.skipStt = true;
    else if (a === "--skip-tts") out.skipTts = true;
    else if (a === "--wavs") out.wavGlob = String(argv[++i]);
    else if (a === "--tts-engine") out.ttsEngine = String(argv[++i]);
    else if (a === "--voice") out.voice = String(argv[++i]);
  }
  return out;
}

async function probeVoices(httpBase: string, engine?: string): Promise<VoicesProbe> {
  const qs = engine ? `?engine=${encodeURIComponent(engine)}` : "";
  try {
    const res = await fetch(`${httpBase}/voices${qs}`);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = (await res.json()) as {
      engine?: string;
      voices?: Array<{ id?: string; name?: string }>;
    };
    const voices = data.voices ?? [];
    return {
      ok: true,
      engine: data.engine,
      voiceCount: voices.length,
      sampleVoiceIds: voices.slice(0, 5).map((v) => String(v.id ?? v.name ?? "")),
    };
  } catch (err) {
    return { ok: false, error: String((err as Error).message ?? err) };
  }
}

async function ttsTrial(opts: {
  wsBase: string;
  engine?: string;
  voice?: string;
  phrase: string;
}): Promise<TtsTrial> {
  const trial: TtsTrial = {
    phrase: opts.phrase,
    phraseChars: opts.phrase.length,
    ttfaMs: null,
    totalMs: 0,
    chunkCount: 0,
    totalPcmBytes: 0,
    sampleRate: 0,
    ok: false,
  };

  let firstChunkAt: number | null = null;
  const startedAt = performance.now();

  const client = new StreamingTtsClient({
    baseUrl: opts.wsBase,
    engine: opts.engine,
    voice: opts.voice,
    onChunk: ({ pcm, sampleRate }) => {
      if (firstChunkAt == null) firstChunkAt = performance.now();
      trial.chunkCount += 1;
      trial.totalPcmBytes += pcm.byteLength;
      trial.sampleRate = sampleRate;
    },
    onError: (e) => {
      trial.error = e;
    },
  });

  try {
    await client.connect();
    const sendAt = performance.now();
    await client.speak({ text: opts.phrase });
    trial.totalMs = performance.now() - startedAt;
    trial.ttfaMs = firstChunkAt != null ? firstChunkAt - sendAt : null;
    trial.ok = trial.chunkCount > 0 && !trial.error;
  } catch (err) {
    trial.error = String((err as Error).message ?? err);
  } finally {
    client.close();
  }
  return trial;
}

function summarize(trials: TtsTrial[]) {
  const ok = trials.filter((t) => t.ok);
  if (ok.length === 0) return null;
  const ttfas = ok.map((t) => t.ttfaMs ?? 0).sort((a, b) => a - b);
  const totals = ok.map((t) => t.totalMs).sort((a, b) => a - b);
  const p = (arr: number[], q: number) => arr[Math.min(arr.length - 1, Math.floor(arr.length * q))];
  return {
    count: ok.length,
    ttfa_p50: Math.round(p(ttfas, 0.5)),
    ttfa_p95: Math.round(p(ttfas, 0.95)),
    total_p50: Math.round(p(totals, 0.5)),
    total_p95: Math.round(p(totals, 0.95)),
  };
}

async function resolveWavs(pattern: string): Promise<string[]> {
  const glob = new Glob(pattern);
  const out: string[] = [];
  for await (const path of glob.scan({ cwd: process.cwd(), absolute: true })) {
    out.push(path);
  }
  return out.sort();
}

async function main() {
  const args = parseArgs();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = resolve(process.cwd(), "artifacts", "voice-bench", stamp);
  await mkdir(outDir, { recursive: true });

  console.log(`voice-bench · runs=${args.runs} skipStt=${args.skipStt} skipTts=${args.skipTts}`);

  let core: VoiceCoreHandle | null = null;
  const ttsTrials: TtsTrial[] = [];
  const sttTrials: SttTrial[] = [];
  let voicesProbe: VoicesProbe = { ok: false, error: "not run" };

  try {
    core = await ensureVoiceCore(60_000);
    const wsBase = core.url;
    const httpBase = wsBase.replace(/^ws/, "http");
    console.log(`voice-core · ws=${wsBase}`);

    voicesProbe = await probeVoices(httpBase, args.ttsEngine);
    console.log(`voices · ${voicesProbe.ok ? `${voicesProbe.voiceCount} voices (engine=${voicesProbe.engine})` : `FAIL: ${voicesProbe.error}`}`);

    if (!args.skipTts) {
      for (const phrase of PHRASES) {
        for (let r = 0; r < args.runs; r++) {
          const trial = await ttsTrial({
            wsBase,
            engine: args.ttsEngine,
            voice: args.voice,
            phrase,
          });
          ttsTrials.push(trial);
          const tag = trial.ok
            ? `ttfa=${Math.round(trial.ttfaMs ?? -1)}ms total=${Math.round(trial.totalMs)}ms chunks=${trial.chunkCount}`
            : `FAIL: ${trial.error ?? "no chunks"}`;
          console.log(`  tts · ${phrase.length}ch #${r + 1}/${args.runs} · ${tag}`);
        }
      }
    }

    if (!args.skipStt) {
      const wavs = await resolveWavs(args.wavGlob);
      console.log(`stt · ${wavs.length} wavs`);
      for (const wav of wavs) {
        try {
          const result = await runSttOnce({ wavPath: wav, voiceCoreUrl: wsBase });
          const ttfa = result.report.spans["stt_ttft"];
          const final = result.report.spans["stt_final_after_last_chunk"];
          sttTrials.push({
            wav: basename(wav),
            ok: !!result.finalText,
            finalText: result.finalText,
            ttfaMs: typeof ttfa === "number" ? Math.round(ttfa) : undefined,
            finalMs: typeof final === "number" ? Math.round(final) : undefined,
          });
          console.log(`  stt · ${basename(wav)} · ttfa=${ttfa}ms final=${final}ms text="${result.finalText.slice(0, 40)}"`);
        } catch (err) {
          sttTrials.push({ wav: basename(wav), ok: false, error: String((err as Error).message ?? err) });
        }
      }
    }
  } finally {
    if (core) await stopVoiceCore(core);
  }

  const ttsSummary = summarize(ttsTrials);
  const report = {
    stamp,
    args,
    voices: voicesProbe,
    tts: { trials: ttsTrials, summary: ttsSummary },
    stt: { trials: sttTrials },
  };

  await writeFile(resolve(outDir, "report.json"), JSON.stringify(report, null, 2));
  await writeFile(resolve(outDir, "report.md"), buildMarkdown(report));
  console.log(`\nreport · ${outDir}`);
  if (ttsSummary) {
    console.log(`tts · p50 ttfa ${ttsSummary.ttfa_p50}ms · p95 ${ttsSummary.ttfa_p95}ms`);
  }
}

function buildMarkdown(report: {
  stamp: string;
  args: CliArgs;
  voices: VoicesProbe;
  tts: { trials: TtsTrial[]; summary: ReturnType<typeof summarize> };
  stt: { trials: SttTrial[] };
}): string {
  const lines: string[] = [];
  lines.push(`# voice-bench · ${report.stamp}`);
  lines.push("");
  lines.push(`runs/phrase: ${report.args.runs} · engine: ${report.args.ttsEngine ?? "default"} · voice: ${report.args.voice ?? "default"}`);
  lines.push("");

  lines.push(`## /voices`);
  if (report.voices.ok) {
    lines.push(`- engine: \`${report.voices.engine}\``);
    lines.push(`- count: ${report.voices.voiceCount}`);
    lines.push(`- sample: ${(report.voices.sampleVoiceIds ?? []).map((s) => `\`${s}\``).join(", ") || "—"}`);
  } else {
    lines.push(`- FAIL: ${report.voices.error}`);
  }
  lines.push("");

  lines.push(`## TTS streaming`);
  if (report.tts.summary) {
    lines.push(`p50 TTFA: **${report.tts.summary.ttfa_p50} ms** · p95 TTFA: ${report.tts.summary.ttfa_p95} ms · n=${report.tts.summary.count}`);
    lines.push(`p50 total: ${report.tts.summary.total_p50} ms · p95: ${report.tts.summary.total_p95} ms`);
  } else {
    lines.push(`no successful trials`);
  }
  lines.push("");
  lines.push(`| chars | ttfa(ms) | total(ms) | chunks | sr | ok |`);
  lines.push(`|------:|---------:|----------:|-------:|---:|:---|`);
  for (const t of report.tts.trials) {
    lines.push(`| ${t.phraseChars} | ${t.ttfaMs != null ? Math.round(t.ttfaMs) : "—"} | ${Math.round(t.totalMs)} | ${t.chunkCount} | ${t.sampleRate} | ${t.ok ? "✓" : `✗ ${t.error ?? ""}`} |`);
  }
  lines.push("");

  if (report.stt.trials.length > 0) {
    lines.push(`## STT streaming`);
    lines.push(`| wav | ttfa(ms) | final(ms) | text |`);
    lines.push(`|-----|---------:|----------:|------|`);
    for (const t of report.stt.trials) {
      const text = t.finalText ?? (t.error ? `ERROR: ${t.error}` : "");
      lines.push(`| ${t.wav} | ${t.ttfaMs ?? "—"} | ${t.finalMs ?? "—"} | ${text.slice(0, 60)} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
