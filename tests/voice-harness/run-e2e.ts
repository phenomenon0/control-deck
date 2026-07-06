#!/usr/bin/env bun
/**
 * E2E batch driver: feed N WAVs × M runs through the full voice pipeline
 * (voice-core STT → agent-ts LLM → voice-core TTS), aggregate latencies,
 * write Markdown + JSON.
 *
 *   bun tests/voice-harness/run-e2e.ts \
 *       --wavs 'models/voice-engines/sherpa-streaming/test_wavs/*.wav' \
 *       --runs 2 \
 *       --stt sherpa-onnx-streaming \
 *       --tts kokoro \
 *       --voice af_bella
 *
 * Expects voice-core (4245) and agent-ts (4244) already running. Use
 * ./start-full-stack.sh status to verify, ./start-full-stack.sh start to bring up.
 *
 * Reports land at tests/voice-harness/reports/<timestamp>/{summary.md,raw.json}.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve, basename } from "node:path";
import { Glob } from "bun";

import { aggregateReports, type ProbeReport } from "@/lib/voice/test-harness/latency-probe";

import { runE2EOnce, type RunE2EResult } from "./lib/run-e2e-once";

interface Args {
  wavs: string;
  runs: number;
  voiceCoreUrl: string;
  agentTsUrl: string;
  sttEngine?: string;
  ttsEngine?: string;
  voice?: string;
  llmModel?: string;
  systemPrompt?: string;
}

interface RunRecord {
  wav: string;
  runIndex: number;
  ok: boolean;
  sttText: string;
  llmText: string;
  ttsChunks: number;
  ttsBytes: number;
  error?: string;
  report: ProbeReport;
}

async function main() {
  const args = parseArgs();
  const wavs = await resolveWavs(args.wavs);
  if (wavs.length === 0) {
    console.error(`no WAVs matched: ${args.wavs}`);
    process.exit(1);
  }
  console.log(
    `e2e-harness · wavs=${wavs.length} runs=${args.runs} stt=${args.sttEngine ?? "<default>"} tts=${args.ttsEngine ?? "<default>"} voice=${args.voice ?? "<default>"}`,
  );

  await preflight(args);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportDir = resolve(import.meta.dir, "reports", stamp);
  await mkdir(reportDir, { recursive: true });

  const all: RunRecord[] = [];
  for (const wav of wavs) {
    for (let i = 0; i < args.runs; i++) {
      const rec = await runOne(wav, i, args);
      all.push(rec);
      const tag = rec.ok ? "ok" : `FAIL: ${rec.error ?? "?"}`;
      const summary = rec.ok
        ? `stt="${trim(rec.sttText, 40)}" llm="${trim(rec.llmText, 40)}" tts=${rec.ttsChunks}ch/${rec.ttsBytes}b`
        : "";
      process.stdout.write(`  ${basename(wav)} #${i + 1}/${args.runs} · ${tag} ${summary}\n`);
    }
  }

  const reports = all.filter((r) => r.ok).map((r) => r.report);
  const agg = aggregateReports(reports);

  await writeFile(resolve(reportDir, "raw.json"), JSON.stringify({ args, runs: all, agg }, null, 2));
  await writeFile(resolve(reportDir, "summary.md"), buildMarkdown(args, all, agg));

  console.log(`\nreport · ${reportDir}/summary.md`);
}

async function preflight(args: Args) {
  const checks: Array<[string, string]> = [
    ["voice-core", `${args.voiceCoreUrl.replace(/^ws/, "http")}/health`],
    ["agent-ts", `${args.agentTsUrl}/health`],
  ];
  for (const [name, url] of checks) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status}`);
    } catch (err) {
      console.error(`✗ ${name} not reachable at ${url}: ${err instanceof Error ? err.message : err}`);
      console.error(`  start the stack: ./start-full-stack.sh start`);
      process.exit(2);
    }
  }
}

// Small instruction-tuned models (llama3.2:1b, qwen3:0.6b, …) hallucinate
// tool calls when given a bare user transcript with no system prompt. This
// default keeps them on the voice-chat happy-path; override with --system.
const DEFAULT_SYSTEM_PROMPT =
  "You are a voice assistant in a phone-call setting. Reply directly to the user in one or two short, natural sentences of plain text. Do not call any tools.";

async function runOne(wav: string, runIndex: number, args: Args): Promise<RunRecord> {
  try {
    const result: RunE2EResult = await runE2EOnce({
      wavPath: wav,
      voiceCoreUrl: args.voiceCoreUrl,
      agentTsUrl: args.agentTsUrl,
      sttEngine: args.sttEngine,
      ttsEngine: args.ttsEngine,
      voice: args.voice,
      llmModel: args.llmModel,
      systemPrompt: args.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    });
    return {
      wav,
      runIndex,
      ok: result.ok,
      sttText: result.sttText,
      llmText: result.llmText,
      ttsChunks: result.ttsChunkCount,
      ttsBytes: result.ttsBytes,
      error: result.error,
      report: result.report,
    };
  } catch (err) {
    return {
      wav,
      runIndex,
      ok: false,
      sttText: "",
      llmText: "",
      ttsChunks: 0,
      ttsBytes: 0,
      error: err instanceof Error ? err.message : String(err),
      report: { startedAt: 0, marks: [], deltas: {}, spans: {} },
    };
  }
}

// Spans we want to highlight at the top of the report — the per-leg timings
// and the end-to-end span. Other spans still appear in the long table.
const HEADLINE_SPANS = [
  "stt_ttft",
  "stt_final_after_last_chunk",
  "stt_to_llm",
  "llm_ttft",
  "llm_total",
  "llm_to_tts",
  "tts_ttft",
  "tts_total",
  "e2e_voice_turn",
];

function buildMarkdown(
  args: Args,
  runs: RunRecord[],
  agg: ReturnType<typeof aggregateReports>,
): string {
  const okCount = runs.filter((r) => r.ok).length;
  const lines: string[] = [];
  lines.push(`# Voice E2E harness report`);
  lines.push("");
  lines.push(`- runs: ${runs.length} (${okCount} ok, ${runs.length - okCount} failed)`);
  lines.push(`- stt: ${args.sttEngine ?? "<default>"}`);
  lines.push(`- tts: ${args.ttsEngine ?? "<default>"} (voice=${args.voice ?? "<default>"})`);
  lines.push(`- llm: ${args.llmModel ?? "<agent-ts default>"}`);
  lines.push(`- generated: ${new Date().toISOString()}`);
  lines.push("");

  lines.push(`## Headline latencies (ms)`);
  lines.push("");
  lines.push(`| span | n | mean | p50 | p95 | min | max |`);
  lines.push(`| ---- | -- | ----:| ---:| ---:| ---:| ---:|`);
  for (const key of HEADLINE_SPANS) {
    const stats = agg.byKey[key];
    if (!stats) continue;
    lines.push(
      `| \`${key}\` | ${stats.count} | ${fmt(stats.mean)} | ${fmt(stats.p50)} | ${fmt(stats.p95)} | ${fmt(stats.min)} | ${fmt(stats.max)} |`,
    );
  }
  lines.push("");

  lines.push(`## All aggregate spans (ms)`);
  lines.push("");
  lines.push(`| span | n | mean | p50 | p95 | min | max |`);
  lines.push(`| ---- | -- | ----:| ---:| ---:| ---:| ---:|`);
  const sorted = Object.entries(agg.byKey).sort(([a], [b]) => a.localeCompare(b));
  for (const [key, stats] of sorted) {
    lines.push(
      `| \`${key}\` | ${stats.count} | ${fmt(stats.mean)} | ${fmt(stats.p50)} | ${fmt(stats.p95)} | ${fmt(stats.min)} | ${fmt(stats.max)} |`,
    );
  }
  lines.push("");

  lines.push(`## Per-run`);
  lines.push("");
  lines.push(`| wav | run | ok | stt | llm | tts |`);
  lines.push(`| --- | --- | -- | --- | --- | --- |`);
  for (const r of runs) {
    const sttCell = r.ok ? trim(r.sttText, 40) : "—";
    const llmCell = r.ok ? trim(r.llmText, 40) : "—";
    const ttsCell = r.ok ? `${r.ttsChunks}ch / ${r.ttsBytes}b` : trim(r.error ?? "—", 40);
    lines.push(
      `| ${basename(r.wav)} | ${r.runIndex + 1} | ${r.ok ? "✓" : "✗"} | ${sttCell} | ${llmCell} | ${ttsCell} |`,
    );
  }
  lines.push("");

  lines.push(`## Per-run span breakdown (ms)`);
  lines.push("");
  lines.push(`| wav | run | ${HEADLINE_SPANS.map((s) => `\`${s}\``).join(" | ")} |`);
  lines.push(`| --- | --- | ${HEADLINE_SPANS.map(() => "---:").join(" | ")} |`);
  for (const r of runs) {
    const cells = HEADLINE_SPANS.map((s) => fmt(r.report.spans[s]));
    lines.push(`| ${basename(r.wav)} | ${r.runIndex + 1} | ${cells.join(" | ")} |`);
  }

  return lines.join("\n");
}

function fmt(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return "—";
  return n.toFixed(0);
}

function trim(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = {
    wavs: "models/voice-engines/sherpa-streaming/test_wavs/*.wav",
    runs: 2,
    voiceCoreUrl: process.env.VOICE_CORE_URL ?? "ws://127.0.0.1:4245",
    agentTsUrl: process.env.AGENT_TS_URL ?? "http://127.0.0.1:4244",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--wavs") args.wavs = argv[++i] ?? args.wavs;
    else if (a === "--runs") args.runs = parseInt(argv[++i] ?? "2", 10);
    else if (a === "--voice-core") args.voiceCoreUrl = argv[++i] ?? args.voiceCoreUrl;
    else if (a === "--agent-ts") args.agentTsUrl = argv[++i] ?? args.agentTsUrl;
    else if (a === "--stt") args.sttEngine = argv[++i];
    else if (a === "--tts") args.ttsEngine = argv[++i];
    else if (a === "--voice") args.voice = argv[++i];
    else if (a === "--model") args.llmModel = argv[++i];
    else if (a === "--system") args.systemPrompt = argv[++i];
  }
  return args;
}

async function resolveWavs(pattern: string): Promise<string[]> {
  const isAbs = pattern.startsWith("/");
  const base = isAbs ? "/" : process.cwd();
  const rel = isAbs ? pattern.slice(1) : pattern;
  const glob = new Glob(rel);
  const out: string[] = [];
  for await (const f of glob.scan({ cwd: base, absolute: true })) {
    if (f.toLowerCase().endsWith(".wav")) out.push(f);
  }
  return out.sort();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
