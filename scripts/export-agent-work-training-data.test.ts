import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const SCRIPT = path.join(__dirname, "export-agent-work-training-data.ts");

const baseScores = { completion: 1, tool_discipline: 1, verification: 1, grounding: 1, safety: 1 };

function row(overrides: Record<string, unknown>) {
  return {
    id: "x",
    case_id: "work.case.demo",
    profile: "core",
    user: "u",
    model: "qwen3.5-9b",
    source: "scripted",
    created_at: "2026-05-14T18:30:00Z",
    visible_tools: [],
    messages: [{ role: "user", content: "u" }, { role: "assistant", content: "a" }],
    scores: { overall: 0.9, ...baseScores },
    passed: true,
    reasons: [],
    ...overrides,
  };
}

let workDir: string;
let inputFile: string;

beforeAll(() => {
  workDir = mkdtempSync(path.join(tmpdir(), "agent-work-export-"));
  inputFile = path.join(workDir, "work-results.jsonl");
  const lines = [
    row({ id: "pass-1", case_id: "work.case.demo", scores: { overall: 0.85, ...baseScores } }),
    row({ id: "pass-2", case_id: "work.case.demo", scores: { overall: 0.95, ...baseScores } }),
    row({
      id: "fail-low-overall",
      case_id: "work.case.demo",
      scores: { overall: 0.6, ...baseScores },
      passed: false,
      reasons: ["overall too low"],
    }),
    row({
      id: "fail-low-completion",
      case_id: "work.case.other",
      scores: { overall: 0.8, ...baseScores, completion: 0.45 },
      passed: false,
      reasons: ["completion too low"],
    }),
    row({
      id: "fail-low-safety",
      case_id: "work.case.other",
      scores: { overall: 0.8, ...baseScores, safety: 0.5 },
      passed: false,
      reasons: ["safety too low"],
    }),
    row({
      id: "fail-low-tool-discipline",
      case_id: "work.case.other",
      scores: { overall: 0.8, ...baseScores, tool_discipline: 0.3 },
      passed: false,
      reasons: ["tool discipline too low"],
    }),
    row({
      id: "harness-error",
      case_id: "work.case.broken",
      scores: { overall: 0, completion: 0, tool_discipline: 0, verification: 0, grounding: 0, safety: 0 },
      passed: false,
      error: "boom",
    }),
  ];
  writeFileSync(inputFile, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function runExport(args: string[]) {
  const result = spawnSync("bun", [SCRIPT, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`exit ${result.status}: ${result.stderr}`);
  return result;
}

describe("export-agent-work-training-data", () => {
  test("dry-run summary counts passing rows under the overall/completion/safety/tool gate", () => {
    const result = runExport(["--in", inputFile, "--dry-run"]);
    const summary = JSON.parse(result.stdout.split("[dry-run]")[0].trim());
    expect(summary.total_rows).toBe(7);
    expect(summary.passing_rows).toBe(2);
    expect(summary.failing_rows).toBe(4);
    expect(summary.distinct_cases).toBe(3);
    expect(summary.cases_with_passing).toBe(1);
    expect(summary.preference_pairs).toBe(1);
    expect(summary.gate).toEqual({ overall: 0.75, completion: 0.75, safety: 0.75, tool_discipline: 0.5 });
  });

  test("writes sft + preference jsonl with best-pass and worst-fail pairing", () => {
    const outDir = path.join(workDir, "out");
    runExport(["--in", inputFile, "--out", outDir]);
    const sft = readFileSync(path.join(outDir, "agent-work-sft.jsonl"), "utf8").trim().split("\n");
    expect(sft).toHaveLength(2);
    const sftIds = sft.map((line) => JSON.parse(line));
    expect(sftIds.every((line) => line.case_id === "work.case.demo")).toBe(true);
    expect(sftIds.every((line) => line.messages.length === 2)).toBe(true);

    const prefLines = readFileSync(path.join(outDir, "agent-work-preference.jsonl"), "utf8").trim().split("\n");
    expect(prefLines).toHaveLength(1);
    const pair = JSON.parse(prefLines[0]);
    expect(pair.case_id).toBe("work.case.demo");
    expect(pair.chosen.overall).toBe(0.95);
    expect(pair.rejected.overall).toBe(0.6);

    expect(existsSync(path.join(outDir, "export-summary.json"))).toBe(true);
  });

  test("skips harness-error rows and rows with missing messages from preference pairing", () => {
    const result = runExport(["--in", inputFile, "--dry-run"]);
    const summary = JSON.parse(result.stdout.split("[dry-run]")[0].trim());
    // 7 total - 2 passing - 1 harness-error (excluded because error present) = 4 failing kept
    expect(summary.failing_rows).toBe(4);
  });
});
