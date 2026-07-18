#!/usr/bin/env bun
/**
 * eval-gate.ts — eval floor gate.
 *
 * Reads the latest recorded eval run from artifacts/mcp-evals/ and fails
 * (exit 1) when its pass rate drops below the recorded baseline floor.
 * This is the regression tripwire for the eval suites: the suites themselves
 * need live services to re-run, but their recorded results are committed, so
 * the floor can be asserted anywhere — including CI and pre-push.
 *
 *   bun scripts/eval-gate.ts                      # latest agent-work run vs floor
 *   bun scripts/eval-gate.ts --mode first         # gate a different suite
 *   bun scripts/eval-gate.ts --floor 0.95         # override the floor
 *   bun scripts/eval-gate.ts --require-runs       # exit 1 when no runs are recorded
 *
 * Baseline (recorded 2026-05-14, model qwen3.5-9b):
 *   artifacts/mcp-evals/2026-05-14T23-26-57-829Z/work-summary.json
 *   agent-work scripted suite: 10/11 cases passed = 90.9% (the one failure,
 *   work.handoff.plan_test_harness, was a model-side JSON parse error).
 * The floor is the baseline pass rate; a newer run must do at least as well.
 *
 * Only ISO-timestamped run directories (produced by scripts/mcp-tool-eval.ts)
 * are considered; ad-hoc dirs like windows-native-smoke* are ignored.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..");

/** See header: latest agent-work baseline run, 10/11 passed. */
const BASELINE_RUN_DIR = "2026-05-14T23-26-57-829Z";
const BASELINE_PASS_RATE = 10 / 11; // ≈ 0.9091

const SUMMARY_FILE_BY_MODE: Record<string, string> = {
  first: "summary.json",
  dialog: "dialog-summary.json",
  live: "live-summary.json",
  work: "work-summary.json",
};

/** Run dirs written by mcp-tool-eval.ts: new Date().toISOString().replace(/[:.]/g, "-"). */
const RUN_DIR_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/;

type EvalRunEntry = {
  id?: string;
  case_id?: string;
  passed?: boolean;
  error?: string;
  reasons?: string[];
};

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1];
  const prefix = `${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

function loadRun(summaryPath: string): { entries: EvalRunEntry[]; model?: string } | null {
  try {
    const parsed = JSON.parse(readFileSync(summaryPath, "utf8")) as {
      model?: string;
      results?: EvalRunEntry[];
    };
    if (!Array.isArray(parsed.results)) return null;
    return { entries: parsed.results, model: parsed.model };
  } catch {
    return null;
  }
}

function failingLabels(entries: EvalRunEntry[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of entries) {
    if (entry.passed) continue;
    const label = entry.case_id ?? entry.id ?? "(unknown case)";
    const reason = entry.error
      ? `error: ${entry.error.slice(0, 160)}`
      : (entry.reasons ?? []).join("; ").slice(0, 160);
    out.set(label, reason || "failed");
  }
  return out;
}

function main(): void {
  const mode = argValue("--mode") ?? "work";
  const summaryFile = SUMMARY_FILE_BY_MODE[mode];
  if (!summaryFile) {
    console.error(`unknown --mode ${mode}; expected one of: ${Object.keys(SUMMARY_FILE_BY_MODE).join(", ")}`);
    process.exit(1);
  }
  const artifactsDir = resolve(argValue("--artifacts-dir") ?? join(REPO_ROOT, "artifacts/mcp-evals"));
  const floorRaw = argValue("--floor");
  const floor = floorRaw !== undefined ? Number(floorRaw) : BASELINE_PASS_RATE;
  if (!Number.isFinite(floor) || floor < 0 || floor > 1) {
    console.error(`invalid --floor ${floorRaw}; expected a number in [0, 1]`);
    process.exit(1);
  }
  const requireRuns = process.argv.includes("--require-runs");

  const runDirs = existsSync(artifactsDir)
    ? readdirSync(artifactsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && RUN_DIR_PATTERN.test(entry.name))
      .map((entry) => entry.name)
      .filter((name) => existsSync(join(artifactsDir, name, summaryFile)))
      .sort()
    : [];

  if (runDirs.length === 0) {
    const message = `[eval-gate] no recorded ${mode} runs with ${summaryFile} under ${artifactsDir}`;
    if (requireRuns) {
      console.error(`${message} — failing because --require-runs was passed.`);
      process.exit(1);
    }
    console.log(`${message} — gate vacuously green (record one with the eval suite to arm the gate).`);
    process.exit(0);
  }

  const latestDir = runDirs[runDirs.length - 1];
  const latestPath = join(artifactsDir, latestDir, summaryFile);
  const latest = loadRun(latestPath);
  if (!latest || latest.entries.length === 0) {
    console.error(`[eval-gate] could not read results from ${latestPath}`);
    process.exit(1);
  }

  const total = latest.entries.length;
  const passed = latest.entries.filter((entry) => entry.passed).length;
  const rate = passed / total;

  console.log(`[eval-gate] mode=${mode} latest run: ${latestDir} (model: ${latest.model ?? "unknown"})`);
  console.log(`[eval-gate] pass rate: ${passed}/${total} = ${(rate * 100).toFixed(1)}% — floor: ${(floor * 100).toFixed(1)}% (baseline ${BASELINE_RUN_DIR}, 10/11)`);

  if (rate + 1e-9 >= floor) {
    console.log("[eval-gate] PASS — at or above the recorded baseline floor.");
    process.exit(0);
  }

  // Below the floor: print the diff — which cases fail now, and whether they
  // already failed in the baseline run (known) or are new regressions.
  const baselinePath = join(artifactsDir, BASELINE_RUN_DIR, summaryFile);
  const baseline = existsSync(baselinePath) ? loadRun(baselinePath) : null;
  const baselineFailures = baseline ? failingLabels(baseline.entries) : new Map<string, string>();
  const currentFailures = failingLabels(latest.entries);

  console.error(`[eval-gate] FAIL — pass rate ${(rate * 100).toFixed(1)}% is below the floor ${(floor * 100).toFixed(1)}% (${passed}/${total}).`);
  console.error(`[eval-gate] failing cases in ${latestDir}:`);
  for (const [label, reason] of currentFailures) {
    const kind = baselineFailures.has(label) ? "known-failure" : "NEW-REGRESSION";
    console.error(`  ✗ ${label} [${kind}] — ${reason}`);
  }
  const recovered = [...baselineFailures.keys()].filter((label) => !currentFailures.has(label));
  if (recovered.length > 0) {
    console.error(`[eval-gate] recovered since baseline: ${recovered.join(", ")}`);
  }
  process.exit(1);
}

main();
