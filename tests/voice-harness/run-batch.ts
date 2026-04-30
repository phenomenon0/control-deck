#!/usr/bin/env bun
/**
 * Batch driver: feed N WAVs × M runs through the voice harness, aggregate
 * latency stats, and write a Markdown + JSON report.
 *
 *   bun tests/voice-harness/run-batch.ts \
 *       --wavs 'models/voice-engines/sherpa-streaming/test_wavs/*.wav' \
 *       --runs 5 \
 *       --layer bun
 *
 *   --layer bun  → uses StreamingSttClient + voice-core directly (fast).
 *   --layer e2e  → invokes Playwright per run (slow, but exercises the full UI).
 *   --layer both → first bun, then e2e.
 *
 * Reports land at tests/voice-harness/reports/<timestamp>/{summary.md,raw.json}.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve, basename } from "node:path";
import { spawn } from "node:child_process";
import { Glob } from "bun";

import { aggregateReports, type ProbeReport } from "@/lib/voice/test-harness/latency-probe";
import {
  ensureVoiceCore,
  stopVoiceCore,
  type VoiceCoreHandle,
} from "@/lib/voice/test-harness/voice-core-fixture";

import { runSttOnce, type RunSttResult } from "./lib/run-stt-once";

interface Args {
  wavs: string;
  runs: number;
  layer: "bun" | "e2e" | "both";
}

interface RunRecord {
  wav: string;
  runIndex: number;
  layer: "bun" | "e2e";
  ok: boolean;
  finalText?: string;
  partialsCount?: number;
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
  console.log(`harness · wavs=${wavs.length} runs=${args.runs} layer=${args.layer}`);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportDir = resolve(import.meta.dir, "reports", stamp);
  await mkdir(reportDir, { recursive: true });

  const all: RunRecord[] = [];

  if (args.layer === "bun" || args.layer === "both") {
    let core: VoiceCoreHandle | null = null;
    try {
      core = await ensureVoiceCore(60_000);
      console.log(`voice-core · ${core.url}`);
      for (const wav of wavs) {
        for (let i = 0; i < args.runs; i++) {
          const rec = await runOneBun(wav, core.url, i);
          all.push(rec);
          process.stdout.write(`  bun · ${basename(wav)} #${i + 1}/${args.runs} · ${rec.ok ? "ok" : "fail"}\n`);
        }
      }
    } finally {
      if (core) await stopVoiceCore(core);
    }
  }

  if (args.layer === "e2e" || args.layer === "both") {
    for (const wav of wavs) {
      for (let i = 0; i < args.runs; i++) {
        const rec = await runOneE2E(wav, i);
        all.push(rec);
        process.stdout.write(`  e2e · ${basename(wav)} #${i + 1}/${args.runs} · ${rec.ok ? "ok" : "fail"}\n`);
      }
    }
  }

  const reports = all.filter((r) => r.ok).map((r) => r.report);
  const agg = aggregateReports(reports);

  await writeFile(resolve(reportDir, "raw.json"), JSON.stringify({ args, runs: all, agg }, null, 2));
  await writeFile(resolve(reportDir, "summary.md"), buildMarkdown(args, all, agg));

  console.log(`\nreport · ${reportDir}/summary.md`);
}

async function runOneBun(wav: string, url: string, runIndex: number): Promise<RunRecord> {
  try {
    const result: RunSttResult = await runSttOnce({ wavPath: wav, voiceCoreUrl: url });
    return {
      wav,
      runIndex,
      layer: "bun",
      ok: result.finalText.length > 0,
      finalText: result.finalText,
      partialsCount: result.partials.length,
      report: result.report,
    };
  } catch (err) {
    return {
      wav,
      runIndex,
      layer: "bun",
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      report: { startedAt: 0, marks: [], deltas: {}, spans: {} },
    };
  }
}

async function runOneE2E(wav: string, runIndex: number): Promise<RunRecord> {
  // Spawns Playwright with the WAV passed via env so the spec's `wav` fixture
  // can pick it up. Playwright reads back the per-run JSON written by the spec.
  return new Promise((resolveResult) => {
    const env = { ...process.env, HARNESS_WAV: wav };
    const child = spawn(
      "npx",
      ["playwright", "test", "--config", "tests/voice-harness/e2e/playwright.config.ts"],
      { env, stdio: "inherit" },
    );
    child.on("exit", (code) => {
      const ok = code === 0;
      // The spec writes per-WAV JSON that we could re-ingest; for now we
      // record an OK/FAIL with an empty probe (the spec's own report file is
      // the authoritative artifact for e2e).
      resolveResult({
        wav,
        runIndex,
        layer: "e2e",
        ok,
        report: { startedAt: 0, marks: [], deltas: {}, spans: {} },
      });
    });
  });
}

function buildMarkdown(
  args: Args,
  runs: RunRecord[],
  agg: ReturnType<typeof aggregateReports>,
): string {
  const okCount = runs.filter((r) => r.ok).length;
  const lines: string[] = [];
  lines.push(`# Voice harness report`);
  lines.push("");
  lines.push(`- runs: ${runs.length} (${okCount} ok, ${runs.length - okCount} failed)`);
  lines.push(`- layer: ${args.layer}`);
  lines.push(`- generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push(`## Aggregate latencies (ms)`);
  lines.push("");
  lines.push(`| span | n | mean | p50 | p95 | min | max |`);
  lines.push(`| ---- | -- | ----:| ---:| ---:| ---:| ---:|`);
  for (const [key, stats] of Object.entries(agg.byKey)) {
    lines.push(
      `| \`${key}\` | ${stats.count} | ${fmt(stats.mean)} | ${fmt(stats.p50)} | ${fmt(stats.p95)} | ${fmt(stats.min)} | ${fmt(stats.max)} |`,
    );
  }
  lines.push("");
  lines.push(`## Per-run`);
  lines.push("");
  lines.push(`| layer | wav | run | ok | partials | final |`);
  lines.push(`| ----- | --- | --- | -- | -------:| ----- |`);
  for (const r of runs) {
    lines.push(
      `| ${r.layer} | ${basename(r.wav)} | ${r.runIndex + 1} | ${r.ok ? "✓" : "✗"} | ${r.partialsCount ?? "—"} | ${trim(r.finalText ?? r.error ?? "", 60)} |`,
    );
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
  let wavs = "models/voice-engines/sherpa-streaming/test_wavs/*.wav";
  let runs = 3;
  let layer: Args["layer"] = "bun";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--wavs") wavs = argv[++i] ?? wavs;
    else if (a === "--runs") runs = parseInt(argv[++i] ?? "3", 10);
    else if (a === "--layer") {
      const v = argv[++i] ?? "bun";
      if (v === "bun" || v === "e2e" || v === "both") layer = v;
    }
  }
  return { wavs, runs, layer };
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
