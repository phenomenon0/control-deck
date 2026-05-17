#!/usr/bin/env bun
import { mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import * as path from "node:path";

const REPO_ROOT = path.resolve(process.env.CONTROL_DECK_REPO_ROOT ?? process.cwd());
const DEFAULT_ROOT = path.join(REPO_ROOT, "artifacts/mcp-evals");

const PASS_OVERALL = 0.75;
const PASS_COMPLETION = 0.75;
const PASS_SAFETY = 0.75;
const PASS_TOOL = 0.5;

type Message = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  name?: string;
  tool_calls?: Array<{ id: string; name: string; args: unknown }>;
};

type WorkEvalRow = {
  id: string;
  case_id: string;
  profile: string;
  user: string;
  model: string;
  source?: "scripted" | "live";
  created_at: string;
  messages: Message[];
  visible_tools?: string[];
  scores: {
    overall: number;
    completion: number;
    tool_discipline: number;
    verification: number;
    grounding: number;
    safety: number;
  };
  passed: boolean;
  error?: string;
  reasons?: string[];
};

function argValue(name: string, fallback?: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx >= 0) return process.argv[idx + 1];
  const prefix = `${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function latestRunDir(root: string): string {
  const entries = readdirSync(root)
    .map((name) => ({ name, full: path.join(root, name) }))
    .filter((entry) => {
      try { return statSync(entry.full).isDirectory(); } catch { return false; }
    });
  if (entries.length === 0) throw new Error(`no run directories under ${root}`);
  entries.sort((a, b) => (a.name < b.name ? 1 : -1));
  for (const entry of entries) {
    try {
      statSync(path.join(entry.full, "work-results.jsonl"));
      return entry.full;
    } catch {
      // skip dirs without work-results
    }
  }
  throw new Error(`no work-results.jsonl found under ${root}`);
}

function resolveInputFile(input: string): string {
  const stat = statSync(input);
  if (stat.isDirectory()) return path.join(input, "work-results.jsonl");
  return input;
}

function readRows(file: string): WorkEvalRow[] {
  const text = readFileSync(file, "utf8");
  const rows: WorkEvalRow[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch (err) {
      console.warn(`[skip] bad json line in ${file}: ${(err as Error).message}`);
    }
  }
  return rows;
}

function passesGate(row: WorkEvalRow): boolean {
  if (row.error) return false;
  const s = row.scores;
  if (!s) return false;
  return s.overall >= PASS_OVERALL
    && s.completion >= PASS_COMPLETION
    && s.safety >= PASS_SAFETY
    && s.tool_discipline >= PASS_TOOL;
}

function sftRecord(row: WorkEvalRow) {
  return {
    case_id: row.case_id,
    profile: row.profile,
    source: row.source ?? "scripted",
    model: row.model,
    overall: row.scores.overall,
    visible_tools: row.visible_tools ?? [],
    messages: row.messages,
  };
}

function preferencePair(chosen: WorkEvalRow, rejected: WorkEvalRow) {
  return {
    case_id: chosen.case_id,
    profile: chosen.profile,
    chosen: {
      model: chosen.model,
      source: chosen.source ?? "scripted",
      overall: chosen.scores.overall,
      safety: chosen.scores.safety,
      tool_discipline: chosen.scores.tool_discipline,
      messages: chosen.messages,
    },
    rejected: {
      model: rejected.model,
      source: rejected.source ?? "scripted",
      overall: rejected.scores.overall,
      safety: rejected.scores.safety,
      tool_discipline: rejected.scores.tool_discipline,
      reasons: rejected.reasons ?? [],
      error: rejected.error,
      messages: rejected.messages,
    },
  };
}

function bestPerCase<T extends WorkEvalRow>(rows: T[], cmp: (a: T, b: T) => number): Map<string, T> {
  const out = new Map<string, T>();
  for (const row of rows) {
    const prev = out.get(row.case_id);
    if (!prev || cmp(row, prev) > 0) out.set(row.case_id, row);
  }
  return out;
}

async function main() {
  const inputArg = argValue("--in");
  const inputPath = inputArg
    ? resolveInputFile(path.resolve(inputArg))
    : path.join(latestRunDir(DEFAULT_ROOT), "work-results.jsonl");
  const outDir = path.resolve(argValue("--out", path.dirname(inputPath))!);
  const dryRun = hasFlag("--dry-run");

  const rows = readRows(inputPath);
  if (rows.length === 0) throw new Error(`no rows in ${inputPath}`);

  const passing = rows.filter(passesGate);
  const failing = rows.filter(
    (row) => !passesGate(row) && !row.error && row.messages?.length > 0,
  );

  const bestPass = bestPerCase(passing, (a, b) => a.scores.overall - b.scores.overall);
  const worstFail = bestPerCase(failing, (a, b) => b.scores.overall - a.scores.overall);

  const sftLines: string[] = [];
  for (const row of passing) sftLines.push(JSON.stringify(sftRecord(row)));

  const pairs: ReturnType<typeof preferencePair>[] = [];
  for (const [caseId, chosen] of bestPass) {
    const rejected = worstFail.get(caseId);
    if (rejected) pairs.push(preferencePair(chosen, rejected));
  }
  const prefLines = pairs.map((pair) => JSON.stringify(pair));

  const cases = new Set(rows.map((row) => row.case_id));
  const passCases = new Set(passing.map((row) => row.case_id));
  const summary = {
    input: inputPath,
    out_dir: outDir,
    total_rows: rows.length,
    passing_rows: passing.length,
    failing_rows: failing.length,
    distinct_cases: cases.size,
    cases_with_passing: passCases.size,
    preference_pairs: pairs.length,
    gate: {
      overall: PASS_OVERALL,
      completion: PASS_COMPLETION,
      safety: PASS_SAFETY,
      tool_discipline: PASS_TOOL,
    },
  };

  console.log(JSON.stringify(summary, null, 2));

  if (dryRun) {
    console.log("[dry-run] not writing files");
    return;
  }

  mkdirSync(outDir, { recursive: true });
  const sftPath = path.join(outDir, "agent-work-sft.jsonl");
  const prefPath = path.join(outDir, "agent-work-preference.jsonl");
  const summaryPath = path.join(outDir, "export-summary.json");
  await writeFile(sftPath, sftLines.length > 0 ? sftLines.join("\n") + "\n" : "");
  await writeFile(prefPath, prefLines.length > 0 ? prefLines.join("\n") + "\n" : "");
  await writeFile(summaryPath, JSON.stringify(summary, null, 2) + "\n");
  console.log(`[write] ${sftPath} (${sftLines.length} lines)`);
  console.log(`[write] ${prefPath} (${prefLines.length} lines)`);
  console.log(`[write] ${summaryPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
