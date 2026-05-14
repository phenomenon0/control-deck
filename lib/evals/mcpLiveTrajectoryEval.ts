import type { McpEvalProfile } from "./mcpToolEval";

export interface LiveTrajectoryExpectation {
  path: string;
  equals?: unknown;
  contains?: string;
}

export interface LiveTrajectoryStep {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  expectations: LiveTrajectoryExpectation[];
}

export interface McpLiveTrajectoryCase {
  id: string;
  profile: McpEvalProfile;
  user: string;
  marker: string;
  steps: LiveTrajectoryStep[];
  notes?: string;
}

export interface LiveBridgeRequest {
  tool: string;
  args: Record<string, unknown>;
}

export type LiveBridgeCaller = (request: LiveBridgeRequest) => Promise<unknown> | unknown;

export interface LiveTrajectoryEvent {
  stepId: string;
  tool: string;
  args: Record<string, unknown>;
  response: unknown;
  success: boolean;
  error_code?: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

export interface McpLiveTrajectoryScore {
  passed: boolean;
  score: number;
  reasons: string[];
  calledTools: string[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (!isRecord(current)) return undefined;
    return current[segment];
  }, value);
}

function responseSuccess(response: unknown): boolean {
  return getPath(response, "success") === true;
}

function responseErrorCode(response: unknown): string | undefined {
  const value = getPath(response, "error_code");
  return typeof value === "string" ? value : undefined;
}

function valuesEqual(actual: unknown, expected: unknown): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

export function buildWorkspaceMacroLiveTrajectoryCase(marker = `workspace-macro-live-${Date.now()}`): McpLiveTrajectoryCase {
  const canvasStatus = `# Live Workspace Macro Trajectory\n\nMarker: ${marker}\n\nThis board was loaded by workspace_show_canvas during live bridge-backed eval.`;
  return {
    id: "core.workspace_macros.live_smoke",
    profile: "core",
    user: "Exercise workspace_show_canvas and workspace_write_note against the live Control Deck bridge, then grade the actual responses.",
    marker,
    steps: [
      {
        id: "show-canvas",
        tool: "workspace_show_canvas",
        args: {
          code: canvasStatus,
          language: "markdown",
          title: "Live Macro Trajectory",
          filename: "live-macro-trajectory.md",
          autoRun: false,
        },
        expectations: [
          { path: "success", equals: true },
          { path: "data.loaded", equals: true },
          { path: "data.target", contains: "canvas:" },
        ],
      },
      {
        id: "write-note",
        tool: "workspace_write_note",
        args: {
          text: `\n\n---\n${marker}`,
          mode: "append",
          verify: true,
        },
        expectations: [
          { path: "success", equals: true },
          { path: "data.verified", equals: true },
          { path: "data.verifyResult", contains: marker },
        ],
      },
    ],
    notes: "Live bridge smoke for semantic workspace macros and artifact/state grading.",
  };
}

export async function runLiveTrajectoryCase(
  testCase: McpLiveTrajectoryCase,
  callBridge: LiveBridgeCaller,
): Promise<LiveTrajectoryEvent[]> {
  const events: LiveTrajectoryEvent[] = [];
  for (const step of testCase.steps) {
    const startedAt = nowIso();
    const started = Date.now();
    let response: unknown;
    try {
      response = await callBridge({ tool: step.tool, args: step.args });
    } catch (error) {
      response = {
        success: false,
        error_code: "bridge_call_exception",
        message: error instanceof Error ? error.message : String(error),
      };
    }
    const finishedAt = nowIso();
    events.push({
      stepId: step.id,
      tool: step.tool,
      args: step.args,
      response,
      success: responseSuccess(response),
      error_code: responseErrorCode(response),
      startedAt,
      finishedAt,
      durationMs: Math.max(0, Date.now() - started),
    });
  }
  return events;
}

export function scoreLiveTrajectoryCase(
  testCase: McpLiveTrajectoryCase,
  events: LiveTrajectoryEvent[],
): McpLiveTrajectoryScore {
  const reasons: string[] = [];
  const calledTools = events.map((event) => event.tool);
  let hardFail = false;
  let score = 1;

  if (events.length !== testCase.steps.length) {
    hardFail = true;
    score -= 0.4;
    reasons.push(`expected ${testCase.steps.length} event(s), got ${events.length}`);
  }

  for (let index = 0; index < testCase.steps.length; index += 1) {
    const step = testCase.steps[index];
    const event = events[index];
    if (!event) continue;

    if (event.tool !== step.tool) {
      hardFail = true;
      score -= 0.4;
      reasons.push(`step ${index} expected tool ${step.tool}, got ${event.tool}`);
      continue;
    }
    reasons.push(`step ${index} called ${step.tool}`);

    if (!event.success) {
      hardFail = true;
      score -= 0.4;
      reasons.push(`step ${index} ${step.tool} failed${event.error_code ? ` with ${event.error_code}` : ""}`);
    }

    for (const expectation of step.expectations) {
      const actual = getPath(event.response, expectation.path);
      if (Object.prototype.hasOwnProperty.call(expectation, "equals") && !valuesEqual(actual, expectation.equals)) {
        hardFail = true;
        score -= 0.25;
        reasons.push(`${step.id}.${expectation.path} expected ${JSON.stringify(expectation.equals)}, got ${JSON.stringify(actual)}`);
      }
      if (expectation.contains !== undefined) {
        if (typeof actual !== "string" || !actual.includes(expectation.contains)) {
          hardFail = true;
          score -= 0.25;
          reasons.push(`${step.id}.${expectation.path} expected to contain ${expectation.contains}, got ${JSON.stringify(actual)}`);
        }
      }
    }
  }

  score = Math.max(0, Math.min(1, Number(score.toFixed(3))));
  return {
    passed: !hardFail && score >= 0.75,
    score,
    reasons,
    calledTools,
  };
}
