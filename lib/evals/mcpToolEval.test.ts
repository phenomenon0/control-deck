import { describe, expect, test } from "bun:test";
import { scoreMcpToolEvalCase, type McpToolEvalCase } from "./mcpToolEval";

const baseCase: McpToolEvalCase = {
  id: "x",
  profile: "core",
  user: "list panes",
  expectedFirstTool: "workspace_list_panes",
};

describe("mcp tool eval scoring", () => {
  test("passes the expected first tool", () => {
    const score = scoreMcpToolEvalCase(
      baseCase,
      [{ name: "workspace_list_panes", argumentsText: "{}" }],
      "",
      ["workspace_list_panes"],
    );

    expect(score.passed).toBe(true);
    expect(score.firstTool).toBe("workspace_list_panes");
    expect(score.score).toBe(1);
  });

  test("fails forbidden tool calls", () => {
    const score = scoreMcpToolEvalCase(
      { ...baseCase, forbiddenTools: ["workspace_pane_call"] },
      [{ name: "workspace_pane_call", argumentsText: "{}" }],
      "",
      ["workspace_list_panes", "workspace_pane_call"],
    );

    expect(score.passed).toBe(false);
    expect(score.reasons.join("\n")).toContain("called forbidden tool");
  });

  test("passes no-tool escalation with capability text", () => {
    const score = scoreMcpToolEvalCase(
      {
        id: "escalate",
        profile: "core",
        user: "run code",
        expectNoTool: true,
        requiredResponseKeywords: ["developer", "profile"],
      },
      [],
      "This needs the developer profile because code execution is not available.",
      ["workspace_list_panes"],
    );

    expect(score.passed).toBe(true);
    expect(score.score).toBe(1);
  });

  test("flags unavailable tool hallucinations", () => {
    const score = scoreMcpToolEvalCase(
      baseCase,
      [{ name: "execute_code", argumentsText: "{}" }],
      "",
      ["workspace_list_panes"],
    );

    expect(score.passed).toBe(false);
    expect(score.hallucinatedTools).toEqual(["execute_code"]);
  });
});
