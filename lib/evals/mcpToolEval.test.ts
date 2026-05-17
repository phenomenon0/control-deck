import { describe, expect, test } from "bun:test";
import { buildMcpToolEvalSystemPrompt, scoreMcpToolEvalCase, type McpToolEvalCase } from "./mcpToolEval";

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

  test("supports desktop-control first-action cases that require a baseline before native control", () => {
    const score = scoreMcpToolEvalCase(
      {
        id: "desktop-control.safe_button.baseline_first",
        profile: "desktop-control",
        user: "Click the OK button in the current Windows dialog and verify it closed.",
        expectedFirstTool: "native_baseline_capture",
        forbiddenTools: ["native_click", "native_click_pixel", "native_invoke"],
      },
      [{ name: "native_baseline_capture", argumentsText: JSON.stringify({ label: "before-ok" }) }],
      "",
      ["native_baseline_capture", "native_locate", "native_invoke", "native_watch_install"],
    );

    expect(score.passed).toBe(true);
    expect(score.firstTool).toBe("native_baseline_capture");
  });

  test("desktop-control prompt teaches Qwen the robust Windows automation order", () => {
    const prompt = buildMcpToolEvalSystemPrompt("desktop-control", [
      "native_baseline_capture",
      "native_watch_install",
      "native_locate",
      "native_invoke",
      "native_watch_drain",
      "native_baseline_restore",
    ]);

    expect(prompt).toContain("native_baseline_capture");
    expect(prompt).toContain("native_watch_install");
    expect(prompt).toContain("prefer native_invoke");
    expect(prompt).toContain("unsupported_platform");
    expect(prompt).toContain("verify");
  });
});
