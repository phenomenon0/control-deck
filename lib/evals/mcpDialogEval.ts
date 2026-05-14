import type { McpEvalProfile, ObservedToolCall } from "./mcpToolEval";

export interface ScriptedToolResult {
  toolName: string;
  result: unknown;
}

export interface McpDialogEvalCase {
  id: string;
  profile: McpEvalProfile;
  user: string;
  expectedToolSequence: string[];
  scriptedToolResults: ScriptedToolResult[];
  expectedArgsByTurn?: Record<number, Record<string, unknown>>;
  forbiddenTools?: string[];
  requiredFinalKeywords?: string[];
  maxTurns?: number;
  notes?: string;
}

export interface ObservedDialogTurn {
  assistantContent: string;
  toolCalls: ObservedToolCall[];
}

export interface McpDialogEvalScore {
  passed: boolean;
  score: number;
  reasons: string[];
  calledTools: string[];
  hallucinatedTools: string[];
}

export const DEFAULT_MCP_DIALOG_EVAL_CASES: McpDialogEvalCase[] = [
  {
    id: "core.workspace_not_open.recover",
    profile: "core",
    user: "List the current Control Deck workspace panes. If the workspace is unavailable, recover safely.",
    expectedToolSequence: ["workspace_list_panes"],
    scriptedToolResults: [
      {
        toolName: "workspace_list_panes",
        result: {
          success: false,
          error_code: "workspace_not_open",
          message: "No workspace client responded",
          recovery: ["Open http://localhost:3333/deck/workspace", "Retry workspace_list_panes"],
          state: { availableClients: 0 },
        },
      },
    ],
    requiredFinalKeywords: ["/deck/workspace", "open"],
    notes: "A recoverable failure should become recovery instructions, not random workspace calls.",
  },
  {
    id: "core.notes.write_and_verify",
    profile: "core",
    user: "Append the text 'Harness online' to the notes pane, then verify the note contains it.",
    expectedToolSequence: ["workspace_list_panes", "workspace_pane_call", "workspace_pane_call"],
    expectedArgsByTurn: {
      1: { target: "notes:notes-default", capability: "notes.append_text" },
      2: { target: "notes:notes-default", capability: "notes.read_text" },
    },
    scriptedToolResults: [
      {
        toolName: "workspace_list_panes",
        result: {
          success: true,
          panes: [
            {
              handle: "notes:notes-default",
              type: "notes",
              label: "Notes",
              capabilities: ["notes.read_text", "notes.append_text", "notes.replace_text"],
            },
            {
              handle: "canvas:canvas-default",
              type: "canvas",
              label: "Canvas",
              capabilities: ["canvas.load_code", "canvas.load_markdown"],
            },
          ],
        },
      },
      {
        toolName: "workspace_pane_call",
        result: { success: true, result: { appended: true } },
      },
      {
        toolName: "workspace_pane_call",
        result: { success: true, result: { text: "Harness online" } },
      },
    ],
    requiredFinalKeywords: ["Harness online", "verified"],
    notes: "Tests the observe -> write -> read-back verification loop.",
  },
  {
    id: "developer.code.execute_and_report",
    profile: "developer",
    user: "Run a sandboxed Python calculation for 19 * 23 and report the verified result.",
    expectedToolSequence: ["execute_code"],
    expectedArgsByTurn: {
      0: { language: "python" },
    },
    scriptedToolResults: [
      {
        toolName: "execute_code",
        result: { success: true, stdout: "437\n", stderr: "", exit_code: 0 },
      },
    ],
    requiredFinalKeywords: ["437"],
  },
  {
    id: "developer.terminal_missing.recover",
    profile: "developer",
    user: "Read the last terminal output and summarize it.",
    expectedToolSequence: ["workspace_list_panes"],
    scriptedToolResults: [
      {
        toolName: "workspace_list_panes",
        result: {
          success: true,
          panes: [
            { handle: "notes:notes-default", type: "notes", label: "Notes", capabilities: ["notes.read_text"] },
          ],
        },
      },
    ],
    requiredFinalKeywords: ["terminal"],
    notes: "If no terminal pane exists, do not guess a terminal handle.",
  },
];

function parseArguments(argumentsText: string | undefined): unknown {
  if (!argumentsText) return {};
  try {
    return JSON.parse(argumentsText);
  } catch {
    return argumentsText;
  }
}

function getObjectValue(object: unknown, key: string): unknown {
  if (!object || typeof object !== "object") return undefined;
  return (object as Record<string, unknown>)[key];
}

function valuesMatch(expected: unknown, actual: unknown): boolean {
  if (typeof expected === "string") return typeof actual === "string" && actual === expected;
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function lastFinalContent(turns: ObservedDialogTurn[]): string {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index].toolCalls.length === 0 && turns[index].assistantContent.trim().length > 0) {
      return turns[index].assistantContent;
    }
  }
  return "";
}

export function scoreMcpDialogEvalCase(
  testCase: McpDialogEvalCase,
  observedTurns: ObservedDialogTurn[],
  availableToolNames: Iterable<string>,
): McpDialogEvalScore {
  const reasons: string[] = [];
  const available = new Set(availableToolNames);
  const calledTools = observedTurns.flatMap((turn) => turn.toolCalls.map((call) => call.name));
  const hallucinatedTools = calledTools.filter((name) => !available.has(name));
  let hardFail = false;
  let score = 1;

  if (hallucinatedTools.length > 0) {
    hardFail = true;
    score -= 0.6;
    reasons.push(`hallucinated unavailable tool(s): ${hallucinatedTools.join(", ")}`);
  }

  const forbiddenCalled = (testCase.forbiddenTools ?? []).filter((toolName) => calledTools.includes(toolName));
  if (forbiddenCalled.length > 0) {
    hardFail = true;
    score -= 0.7;
    reasons.push(`called forbidden tool(s): ${forbiddenCalled.join(", ")}`);
  }

  for (let index = 0; index < testCase.expectedToolSequence.length; index += 1) {
    const expectedTool = testCase.expectedToolSequence[index];
    const turn = observedTurns[index];
    const firstCall = turn?.toolCalls[0];
    if (!firstCall) {
      hardFail = true;
      score -= 0.6;
      reasons.push(`missing expected tool at turn ${index}: ${expectedTool}`);
      continue;
    }
    if (firstCall.name !== expectedTool) {
      hardFail = true;
      score -= 0.7;
      reasons.push(`expected tool ${expectedTool} at turn ${index}, got ${firstCall.name}`);
    } else {
      reasons.push(`turn ${index} correct tool: ${expectedTool}`);
    }
    if (turn.toolCalls.length > 1) {
      score -= 0.1 * (turn.toolCalls.length - 1);
      reasons.push(`turn ${index} called ${turn.toolCalls.length} tools; prefer one at a time`);
    }

    const expectedArgs = testCase.expectedArgsByTurn?.[index];
    if (expectedArgs) {
      const parsedArgs = parseArguments(firstCall.argumentsText);
      for (const [key, expectedValue] of Object.entries(expectedArgs)) {
        const actualValue = getObjectValue(parsedArgs, key);
        if (!valuesMatch(expectedValue, actualValue)) {
          hardFail = true;
          score -= 0.25;
          reasons.push(`turn ${index} arg ${key} expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}`);
        }
      }
    }
  }

  const extraToolTurns = observedTurns
    .slice(testCase.expectedToolSequence.length)
    .filter((turn) => turn.toolCalls.length > 0);
  if (extraToolTurns.length > 0) {
    hardFail = true;
    score -= 0.4;
    reasons.push(`unexpected extra tool turn(s) after expected sequence: ${extraToolTurns.flatMap((turn) => turn.toolCalls.map((call) => call.name)).join(", ")}`);
  }

  const finalContent = lastFinalContent(observedTurns).toLowerCase();
  for (const keyword of testCase.requiredFinalKeywords ?? []) {
    if (!finalContent.includes(keyword.toLowerCase())) {
      hardFail = true;
      score -= 0.2;
      reasons.push(`final response missing keyword: ${keyword}`);
    }
  }

  score = Math.max(0, Math.min(1, Number(score.toFixed(3))));
  return {
    passed: !hardFail && score >= 0.75,
    score,
    reasons,
    calledTools,
    hallucinatedTools,
  };
}
