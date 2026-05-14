#!/usr/bin/env bun
import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import {
  DEFAULT_MCP_TOOL_EVAL_CASES,
  buildMcpToolEvalSystemPrompt,
  scoreMcpToolEvalCase,
  type McpEvalProfile,
  type McpToolEvalCase,
  type ObservedToolCall,
} from "../lib/evals/mcpToolEval";
import {
  DEFAULT_MCP_DIALOG_EVAL_CASES,
  scoreMcpDialogEvalCase,
  type McpDialogEvalCase,
  type ObservedDialogTurn,
} from "../lib/evals/mcpDialogEval";
import {
  buildWorkspaceMacroLiveTrajectoryCase,
  runLiveTrajectoryCase,
  scoreLiveTrajectoryCase,
  type LiveTrajectoryEvent,
  type McpLiveTrajectoryCase,
} from "../lib/evals/mcpLiveTrajectoryEval";

type McporterTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

type OpenAITool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

type EvalResult = {
  id: string;
  profile: McpEvalProfile;
  user: string;
  expectedFirstTool?: string;
  expectNoTool?: boolean;
  availableToolCount: number;
  availableTools: string[];
  assistantContent: string;
  toolCalls: ObservedToolCall[];
  passed: boolean;
  score: number;
  reasons: string[];
  latencyMs: number;
  rawResponse: unknown;
};

type DialogEvalResult = {
  id: string;
  profile: McpEvalProfile;
  user: string;
  availableToolCount: number;
  availableTools: string[];
  turns: ObservedDialogTurn[];
  passed: boolean;
  score: number;
  reasons: string[];
  latencyMs: number;
  rawResponses: unknown[];
};

type LiveTrajectoryEvalResult = {
  id: string;
  profile: McpEvalProfile;
  user: string;
  marker: string;
  bridgeUrl: string;
  events: LiveTrajectoryEvent[];
  passed: boolean;
  score: number;
  reasons: string[];
  latencyMs: number;
};

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: unknown;
  tool_call_id?: string;
  name?: string;
};

type ModelToolCall = ObservedToolCall & {
  id: string;
  raw: unknown;
};

const REPO_ROOT = path.resolve(process.env.CONTROL_DECK_REPO_ROOT ?? process.cwd());
const DEFAULT_WRAPPER = path.join(REPO_ROOT, "scripts/mcp-stdio-wrapper.sh");

function argValue(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1];
  const prefix = `${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  if (found) return found.slice(prefix.length);
  return fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function parseProfiles(raw: string | undefined): McpEvalProfile[] {
  const values = (raw ?? "core,developer")
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  const profiles = values.filter((value): value is McpEvalProfile => value === "core" || value === "developer");
  return profiles.length > 0 ? profiles : ["core", "developer"];
}

function discoverTools(profile: McpEvalProfile, wrapper: string): McporterTool[] {
  const result = spawnSync(
    "npx",
    ["mcporter", "list", "--stdio", wrapper, "--name", "control_deck", "--output", "json"],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 120_000,
      env: {
        ...process.env,
        CONTROL_DECK_MCP_PROFILE: profile,
        MCPORTER_CALL_TIMEOUT: process.env.MCPORTER_CALL_TIMEOUT ?? "30000",
      },
    },
  );

  if (result.status !== 0) {
    throw new Error(
      `mcporter discovery failed for profile ${profile}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }

  const parsed = JSON.parse(result.stdout) as { tools?: McporterTool[] };
  return parsed.tools ?? [];
}

function toOpenAITools(tools: McporterTool[]): OpenAITool[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description ?? `Control Deck MCP tool: ${tool.name}`,
      parameters: tool.inputSchema ?? { type: "object", properties: {} },
    },
  }));
}

function normalizeToolCalls(rawCalls: unknown): ObservedToolCall[] {
  return normalizeModelToolCalls(rawCalls).map(({ name, argumentsText }) => ({ name, argumentsText }));
}

function normalizeModelToolCalls(rawCalls: unknown): ModelToolCall[] {
  if (!Array.isArray(rawCalls)) return [];
  return rawCalls.flatMap((call, index) => {
    if (!call || typeof call !== "object") return [];
    const maybe = call as {
      id?: unknown;
      function?: { name?: unknown; arguments?: unknown };
      name?: unknown;
      arguments?: unknown;
    };
    const name = typeof maybe.function?.name === "string"
      ? maybe.function.name
      : typeof maybe.name === "string"
        ? maybe.name
        : null;
    if (!name) return [];
    const args = maybe.function?.arguments ?? maybe.arguments;
    const id = typeof maybe.id === "string" && maybe.id.length > 0
      ? maybe.id
      : `call_${index}_${name}`;
    return [{
      id,
      name,
      argumentsText: typeof args === "string" ? args : JSON.stringify(args ?? {}),
      raw: call,
    }];
  });
}

async function callModel(opts: {
  baseUrl: string;
  model: string;
  systemPrompt?: string;
  user?: string;
  messages?: ChatMessage[];
  tools: OpenAITool[];
  timeoutMs: number;
}): Promise<{ message: { content?: string | null; tool_calls?: unknown }; raw: unknown; latencyMs: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  const started = Date.now();
  const messages = opts.messages ?? [
    { role: "system" as const, content: opts.systemPrompt ?? "" },
    { role: "user" as const, content: opts.user ?? "" },
  ];
  try {
    const response = await fetch(`${opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.LOCAL_OPENAI_API_KEY ?? "local"}`,
      },
      body: JSON.stringify({
        model: opts.model,
        messages,
        tools: opts.tools,
        tool_choice: "auto",
        temperature: 0,
        max_tokens: 256,
        chat_template_kwargs: { enable_thinking: false },
      }),
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`model HTTP ${response.status}: ${text.slice(0, 2000)}`);
    }
    const raw = JSON.parse(text) as { choices?: Array<{ message?: { content?: string | null; tool_calls?: unknown } }> };
    const message = raw.choices?.[0]?.message ?? {};
    return { message, raw, latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

function formatSummary(results: EvalResult[], model: string, baseUrl: string, outDir: string): string {
  const passed = results.filter((result) => result.passed).length;
  const average = results.length === 0
    ? 0
    : results.reduce((sum, result) => sum + result.score, 0) / results.length;
  const byProfile = new Map<McpEvalProfile, EvalResult[]>();
  for (const result of results) {
    byProfile.set(result.profile, [...(byProfile.get(result.profile) ?? []), result]);
  }

  const lines: string[] = [];
  lines.push(`# Control Deck MCP tool-use eval`);
  lines.push("");
  lines.push(`- Model: \`${model}\``);
  lines.push(`- Endpoint: \`${baseUrl}\``);
  lines.push(`- Cases: ${results.length}`);
  lines.push(`- Pass rate: ${passed}/${results.length} (${Math.round((passed / Math.max(1, results.length)) * 100)}%)`);
  lines.push(`- Average score: ${average.toFixed(2)}`);
  lines.push(`- Output dir: \`${outDir}\``);
  lines.push("");

  for (const [profile, profileResults] of Array.from(byProfile.entries())) {
    const profilePassed = profileResults.filter((result) => result.passed).length;
    lines.push(`## ${profile}`);
    lines.push("");
    lines.push(`Pass: ${profilePassed}/${profileResults.length}`);
    lines.push("");
    lines.push("| case | pass | first tool | score | notes |");
    lines.push("| --- | --- | --- | ---: | --- |");
    for (const result of profileResults) {
      const first = result.toolCalls[0]?.name ?? "(none)";
      const notes = result.reasons.join("; ").replace(/\|/g, "\\|");
      lines.push(`| ${result.id} | ${result.passed ? "yes" : "NO"} | ${first} | ${result.score.toFixed(2)} | ${notes} |`);
    }
    lines.push("");
  }

  const failures = results.filter((result) => !result.passed);
  if (failures.length > 0) {
    lines.push("## Failure details");
    lines.push("");
    for (const result of failures) {
      lines.push(`### ${result.id}`);
      lines.push(`- User: ${result.user}`);
      lines.push(`- Tools called: ${result.toolCalls.map((call) => call.name).join(", ") || "none"}`);
      lines.push(`- Assistant text: ${JSON.stringify(result.assistantContent).slice(0, 500)}`);
      lines.push(`- Reasons: ${result.reasons.join("; ")}`);
      lines.push("");
    }
  }

  return `${lines.join("\n")}\n`;
}

function formatDialogSummary(results: DialogEvalResult[], model: string, baseUrl: string, outDir: string): string {
  const passed = results.filter((result) => result.passed).length;
  const average = results.length === 0
    ? 0
    : results.reduce((sum, result) => sum + result.score, 0) / results.length;
  const lines: string[] = [];
  lines.push(`# Control Deck MCP dialog eval`);
  lines.push("");
  lines.push(`- Model: \`${model}\``);
  lines.push(`- Endpoint: \`${baseUrl}\``);
  lines.push(`- Cases: ${results.length}`);
  lines.push(`- Pass rate: ${passed}/${results.length} (${Math.round((passed / Math.max(1, results.length)) * 100)}%)`);
  lines.push(`- Average score: ${average.toFixed(2)}`);
  lines.push(`- Output dir: \`${outDir}\``);
  lines.push("");
  lines.push("| case | profile | pass | sequence | score | notes |");
  lines.push("| --- | --- | --- | --- | ---: | --- |");
  for (const result of results) {
    const sequence = result.turns
      .map((turn) => turn.toolCalls.map((call) => call.name).join("+") || "final")
      .join(" → ");
    const notes = result.reasons.join("; ").replace(/\|/g, "\\|");
    lines.push(`| ${result.id} | ${result.profile} | ${result.passed ? "yes" : "NO"} | ${sequence} | ${result.score.toFixed(2)} | ${notes} |`);
  }
  lines.push("");

  const failures = results.filter((result) => !result.passed);
  if (failures.length > 0) {
    lines.push("## Failure details");
    lines.push("");
    for (const result of failures) {
      lines.push(`### ${result.id}`);
      lines.push(`- User: ${result.user}`);
      lines.push(`- Sequence: ${result.turns.map((turn) => turn.toolCalls.map((call) => call.name).join("+") || "final").join(" → ")}`);
      const lastTurn = result.turns[result.turns.length - 1];
      lines.push(`- Final text: ${JSON.stringify(lastTurn?.assistantContent ?? "").slice(0, 500)}`);
      lines.push(`- Reasons: ${result.reasons.join("; ")}`);
      lines.push("");
    }
  }

  return `${lines.join("\n")}\n`;
}

function formatLiveTrajectorySummary(results: LiveTrajectoryEvalResult[], bridgeUrl: string, outDir: string): string {
  const passed = results.filter((result) => result.passed).length;
  const average = results.length === 0
    ? 0
    : results.reduce((sum, result) => sum + result.score, 0) / results.length;
  const lines: string[] = [];
  lines.push("# Control Deck MCP live trajectory eval");
  lines.push("");
  lines.push(`- Bridge: \`${bridgeUrl}\``);
  lines.push(`- Cases: ${results.length}`);
  lines.push(`- Pass rate: ${passed}/${results.length} (${Math.round((passed / Math.max(1, results.length)) * 100)}%)`);
  lines.push(`- Average score: ${average.toFixed(2)}`);
  lines.push(`- Output dir: \`${outDir}\``);
  lines.push("");
  lines.push("| case | profile | pass | sequence | score | notes |");
  lines.push("| --- | --- | --- | --- | ---: | --- |");
  for (const result of results) {
    const sequence = result.events.map((event) => `${event.tool}${event.success ? "" : `(${event.error_code ?? "failed"})`}`).join(" → ");
    const notes = result.reasons.join("; ").replace(/\|/g, "\\|");
    lines.push(`| ${result.id} | ${result.profile} | ${result.passed ? "yes" : "NO"} | ${sequence} | ${result.score.toFixed(2)} | ${notes} |`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function callBridgeTool(opts: {
  bridgeUrl: string;
  tool: string;
  args: Record<string, unknown>;
  runId: string;
  timeoutMs: number;
}): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const response = await fetch(opts.bridgeUrl, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tool: opts.tool,
        args: opts.args,
        ctx: {
          thread_id: "mcp-live-trajectory-eval",
          run_id: opts.runId,
          tool_call_id: `${opts.runId}:${opts.tool}`,
          source: "eval",
          modality: "eval",
        },
      }),
    });
    const text = await response.text();
    const parsed = text ? JSON.parse(text) : {};
    if (!response.ok) {
      return {
        success: false,
        error_code: `http_${response.status}`,
        message: text.slice(0, 2000),
        response: parsed,
      };
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

async function runLiveTrajectory(opts: {
  testCase: McpLiveTrajectoryCase;
  bridgeUrl: string;
  timeoutMs: number;
  runId: string;
}): Promise<LiveTrajectoryEvalResult> {
  const started = Date.now();
  const events = await runLiveTrajectoryCase(opts.testCase, (request) =>
    callBridgeTool({
      bridgeUrl: opts.bridgeUrl,
      tool: request.tool,
      args: request.args,
      runId: opts.runId,
      timeoutMs: opts.timeoutMs,
    }),
  );
  const score = scoreLiveTrajectoryCase(opts.testCase, events);
  return {
    id: opts.testCase.id,
    profile: opts.testCase.profile,
    user: opts.testCase.user,
    marker: opts.testCase.marker,
    bridgeUrl: opts.bridgeUrl,
    events,
    passed: score.passed,
    score: score.score,
    reasons: score.reasons,
    latencyMs: Date.now() - started,
  };
}

function scriptedResultFor(testCase: McpDialogEvalCase, index: number, toolName: string): unknown {
  const scripted = testCase.scriptedToolResults[index];
  if (!scripted) return { success: true };
  if (scripted.toolName !== toolName) {
    return {
      success: false,
      error_code: "unexpected_tool",
      message: `Expected scripted tool ${scripted.toolName}, got ${toolName}`,
    };
  }
  return scripted.result;
}

async function runDialogCase(opts: {
  testCase: McpDialogEvalCase;
  baseUrl: string;
  model: string;
  tools: OpenAITool[];
  availableTools: string[];
  timeoutMs: number;
  saveRaw: boolean;
}): Promise<DialogEvalResult> {
  const systemPrompt = buildMcpToolEvalSystemPrompt(opts.testCase.profile, opts.availableTools);
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: opts.testCase.user },
  ];
  const turns: ObservedDialogTurn[] = [];
  const rawResponses: unknown[] = [];
  let totalLatencyMs = 0;
  const maxTurns = opts.testCase.maxTurns ?? opts.testCase.expectedToolSequence.length + 2;

  for (let turnIndex = 0; turnIndex < maxTurns; turnIndex += 1) {
    const { message, raw, latencyMs } = await callModel({
      baseUrl: opts.baseUrl,
      model: opts.model,
      messages,
      tools: opts.tools,
      timeoutMs: opts.timeoutMs,
    });
    totalLatencyMs += latencyMs;
    if (opts.saveRaw) rawResponses.push(raw);

    const modelToolCalls = normalizeModelToolCalls(message.tool_calls);
    const observedToolCalls = modelToolCalls.map(({ name, argumentsText }) => ({ name, argumentsText }));
    turns.push({ assistantContent: message.content ?? "", toolCalls: observedToolCalls });
    messages.push({
      role: "assistant",
      content: message.content ?? null,
      tool_calls: modelToolCalls.map((call) => call.raw),
    });

    if (modelToolCalls.length === 0) break;

    for (let callOffset = 0; callOffset < modelToolCalls.length; callOffset += 1) {
      const call = modelToolCalls[callOffset];
      const scriptedIndex = turns.slice(0, -1).reduce((sum, turn) => sum + turn.toolCalls.length, 0) + callOffset;
      const result = scriptedResultFor(opts.testCase, scriptedIndex, call.name);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        name: call.name,
        content: JSON.stringify(result),
      });
    }
  }

  const score = scoreMcpDialogEvalCase(opts.testCase, turns, opts.availableTools);
  return {
    id: opts.testCase.id,
    profile: opts.testCase.profile,
    user: opts.testCase.user,
    availableToolCount: opts.availableTools.length,
    availableTools: opts.availableTools,
    turns,
    passed: score.passed,
    score: score.score,
    reasons: score.reasons,
    latencyMs: totalLatencyMs,
    rawResponses,
  };
}

async function main() {
  const model = argValue("--model", process.env.CONTROL_DECK_EVAL_MODEL ?? "qwen3.5-9b")!;
  const baseUrl = argValue("--base-url", process.env.CONTROL_DECK_EVAL_BASE_URL ?? "http://127.0.0.1:8080/v1")!;
  const wrapper = argValue("--wrapper", DEFAULT_WRAPPER)!;
  const bridgeUrl = argValue("--bridge-url", process.env.CONTROL_DECK_TOOL_BRIDGE_URL ?? "http://localhost:3333/api/tools/bridge")!;
  const profiles = parseProfiles(argValue("--profiles"));
  const mode = argValue("--mode", "first")!;
  const limitRaw = argValue("--limit");
  const limit = limitRaw ? Number(limitRaw) : undefined;
  const timeoutMs = Number(argValue("--timeout-ms", "180000"));
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.resolve(argValue("--out-dir", path.join(REPO_ROOT, "artifacts/mcp-evals", timestamp))!);
  const saveRaw = hasFlag("--save-raw");

  const runFirst = mode === "first" || mode === "both" || mode === "all";
  const runDialog = mode === "dialog" || mode === "both" || mode === "all";
  const runLive = mode === "live" || mode === "all";
  if (!runFirst && !runDialog && !runLive) throw new Error(`unknown --mode ${mode}; expected first, dialog, live, both, or all`);

  mkdirSync(outDir, { recursive: true });
  const toolsByProfile = new Map<McpEvalProfile, McporterTool[]>();
  if (runFirst || runDialog) {
    for (const profile of profiles) {
      const tools = discoverTools(profile, wrapper);
      toolsByProfile.set(profile, tools);
      console.log(`[discover] ${profile}: ${tools.length} tools (${tools.map((tool) => tool.name).join(", ")})`);
    }
  }

  if (runFirst) {
    const selectedCases = DEFAULT_MCP_TOOL_EVAL_CASES
      .filter((testCase) => profiles.includes(testCase.profile))
      .slice(0, Number.isFinite(limit) && limit && limit > 0 ? limit : undefined);

    if (selectedCases.length === 0) throw new Error("no first-action eval cases selected");

    const results: EvalResult[] = [];
    for (const testCase of selectedCases) {
      const mcpTools = toolsByProfile.get(testCase.profile) ?? [];
      const availableTools = mcpTools.map((tool) => tool.name);
      const systemPrompt = buildMcpToolEvalSystemPrompt(testCase.profile, availableTools);
      const { message, raw, latencyMs } = await callModel({
        baseUrl,
        model,
        systemPrompt,
        user: testCase.user,
        tools: toOpenAITools(mcpTools),
        timeoutMs,
      });
      const toolCalls = normalizeToolCalls(message.tool_calls);
      const assistantContent = message.content ?? "";
      const score = scoreMcpToolEvalCase(testCase, toolCalls, assistantContent, availableTools);
      const result: EvalResult = {
        id: testCase.id,
        profile: testCase.profile,
        user: testCase.user,
        expectedFirstTool: testCase.expectedFirstTool,
        expectNoTool: testCase.expectNoTool,
        availableToolCount: availableTools.length,
        availableTools,
        assistantContent,
        toolCalls,
        passed: score.passed,
        score: score.score,
        reasons: score.reasons,
        latencyMs,
        rawResponse: saveRaw ? raw : undefined,
      };
      results.push(result);
      console.log(
        `[${result.passed ? "PASS" : "FAIL"}] ${testCase.id} first=${toolCalls[0]?.name ?? "none"} score=${score.score.toFixed(2)} ${score.reasons.join("; ")}`,
      );
    }

    const jsonl = results.map((result) => JSON.stringify(result)).join("\n") + "\n";
    await writeFile(path.join(outDir, "results.jsonl"), jsonl);
    await writeFile(path.join(outDir, "summary.json"), JSON.stringify({ model, baseUrl, profiles, results }, null, 2));
    const markdown = formatSummary(results, model, baseUrl, outDir);
    await writeFile(path.join(outDir, "summary.md"), markdown);
    console.log("");
    console.log(markdown);
  }

  if (runDialog) {
    const selectedDialogCases = DEFAULT_MCP_DIALOG_EVAL_CASES
      .filter((testCase) => profiles.includes(testCase.profile))
      .slice(0, Number.isFinite(limit) && limit && limit > 0 ? limit : undefined);

    if (selectedDialogCases.length === 0) throw new Error("no dialog eval cases selected");

    const dialogResults: DialogEvalResult[] = [];
    for (const testCase of selectedDialogCases) {
      const mcpTools = toolsByProfile.get(testCase.profile) ?? [];
      const availableTools = mcpTools.map((tool) => tool.name);
      const result = await runDialogCase({
        testCase,
        baseUrl,
        model,
        tools: toOpenAITools(mcpTools),
        availableTools,
        timeoutMs,
        saveRaw,
      });
      dialogResults.push(result);
      const sequence = result.turns.map((turn) => turn.toolCalls.map((call) => call.name).join("+") || "final").join(" → ");
      console.log(
        `[${result.passed ? "PASS" : "FAIL"}] ${testCase.id} seq=${sequence} score=${result.score.toFixed(2)} ${result.reasons.join("; ")}`,
      );
    }

    const jsonl = dialogResults.map((result) => JSON.stringify(result)).join("\n") + "\n";
    await writeFile(path.join(outDir, "dialog-results.jsonl"), jsonl);
    await writeFile(path.join(outDir, "dialog-summary.json"), JSON.stringify({ model, baseUrl, profiles, results: dialogResults }, null, 2));
    const markdown = formatDialogSummary(dialogResults, model, baseUrl, outDir);
    await writeFile(path.join(outDir, "dialog-summary.md"), markdown);
    console.log("");
    console.log(markdown);
  }

  if (runLive) {
    const marker = `mcp-live-${timestamp}`;
    const liveCases = [buildWorkspaceMacroLiveTrajectoryCase(marker)]
      .filter((testCase) => profiles.includes(testCase.profile));
    if (liveCases.length === 0) throw new Error("no live trajectory eval cases selected");

    const liveResults: LiveTrajectoryEvalResult[] = [];
    for (const testCase of liveCases) {
      const result = await runLiveTrajectory({
        testCase,
        bridgeUrl,
        timeoutMs,
        runId: `${timestamp}:${testCase.id}`,
      });
      liveResults.push(result);
      const sequence = result.events.map((event) => `${event.tool}${event.success ? "" : `(${event.error_code ?? "failed"})`}`).join(" → ");
      console.log(
        `[${result.passed ? "PASS" : "FAIL"}] ${testCase.id} seq=${sequence} score=${result.score.toFixed(2)} ${result.reasons.join("; ")}`,
      );
    }

    const jsonl = liveResults.map((result) => JSON.stringify(result)).join("\n") + "\n";
    await writeFile(path.join(outDir, "live-results.jsonl"), jsonl);
    await writeFile(path.join(outDir, "live-summary.json"), JSON.stringify({ bridgeUrl, profiles, results: liveResults }, null, 2));
    const markdown = formatLiveTrajectorySummary(liveResults, bridgeUrl, outDir);
    await writeFile(path.join(outDir, "live-summary.md"), markdown);
    console.log("");
    console.log(markdown);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
