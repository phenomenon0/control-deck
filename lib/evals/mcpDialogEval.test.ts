import { describe, expect, test } from "bun:test";
import {
  DEFAULT_MCP_DIALOG_EVAL_CASES,
  scoreMcpDialogEvalCase,
  type McpDialogEvalCase,
} from "./mcpDialogEval";

const notesCase: McpDialogEvalCase = {
  id: "core.notes.write_and_verify",
  profile: "core",
  user: "Append Harness online to notes and verify it.",
  expectedToolSequence: ["workspace_list_panes", "workspace_pane_call", "workspace_pane_call"],
  expectedArgsByTurn: {
    1: { capability: "notes.append_text", target: "notes:notes-default" },
    2: { capability: "notes.read_text", target: "notes:notes-default" },
  },
  scriptedToolResults: [],
};

describe("mcp dialog eval scoring", () => {
  test("passes expected multi-turn workspace write then verify sequence", () => {
    const score = scoreMcpDialogEvalCase(
      notesCase,
      [
        { assistantContent: "", toolCalls: [{ name: "workspace_list_panes", argumentsText: "{}" }] },
        {
          assistantContent: "",
          toolCalls: [
            {
              name: "workspace_pane_call",
              argumentsText: JSON.stringify({
                target: "notes:notes-default",
                capability: "notes.append_text",
                args: { text: "Harness online" },
              }),
            },
          ],
        },
        {
          assistantContent: "",
          toolCalls: [
            {
              name: "workspace_pane_call",
              argumentsText: JSON.stringify({
                target: "notes:notes-default",
                capability: "notes.read_text",
                args: {},
              }),
            },
          ],
        },
        { assistantContent: "Verified: Harness online", toolCalls: [] },
      ],
      ["workspace_list_panes", "workspace_pane_call"],
    );

    expect(score.passed).toBe(true);
    expect(score.score).toBe(1);
  });

  test("fails when a write is not verified", () => {
    const score = scoreMcpDialogEvalCase(
      notesCase,
      [
        { assistantContent: "", toolCalls: [{ name: "workspace_list_panes", argumentsText: "{}" }] },
        {
          assistantContent: "",
          toolCalls: [
            {
              name: "workspace_pane_call",
              argumentsText: JSON.stringify({
                target: "notes:notes-default",
                capability: "notes.append_text",
                args: { text: "Harness online" },
              }),
            },
          ],
        },
        { assistantContent: "Done", toolCalls: [] },
      ],
      ["workspace_list_panes", "workspace_pane_call"],
    );

    expect(score.passed).toBe(false);
    expect(score.reasons.join("\n")).toContain("missing expected tool at turn 2");
  });

  test("scores workspace-not-open recovery as no second tool plus recovery text", () => {
    const recoveryCase = DEFAULT_MCP_DIALOG_EVAL_CASES.find((testCase) => testCase.id === "core.workspace_not_open.recover")!;
    const score = scoreMcpDialogEvalCase(
      recoveryCase,
      [
        { assistantContent: "", toolCalls: [{ name: "workspace_list_panes", argumentsText: "{}" }] },
        { assistantContent: "Workspace is not open. Please open /deck/workspace and retry.", toolCalls: [] },
      ],
      ["workspace_list_panes", "workspace_pane_call"],
    );

    expect(score.passed).toBe(true);
  });

  test("passes robust Windows native invoke flow with baseline, watcher, action, drain, and verify", () => {
    const nativeCase: McpDialogEvalCase = {
      id: "desktop-control.native_ok.invoke_verified",
      profile: "desktop-control",
      user: "Click OK in the current Windows dialog and verify the dialog closed.",
      expectedToolSequence: [
        "native_baseline_capture",
        "native_watch_install",
        "native_locate",
        "native_invoke",
        "native_watch_drain",
        "native_locate",
      ],
      expectedArgsByTurn: {
        1: { action: "notify" },
        2: { name: "OK", role: "button" },
        3: { pattern: "Invoke", action: "Invoke" },
      },
      scriptedToolResults: [],
      requiredFinalKeywords: ["verified", "OK"],
    };

    const okHandle = { id: "uia:ok", role: "button", name: "OK" };
    const score = scoreMcpDialogEvalCase(
      nativeCase,
      [
        { assistantContent: "", toolCalls: [{ name: "native_baseline_capture", argumentsText: JSON.stringify({ label: "before-ok" }) }] },
        { assistantContent: "", toolCalls: [{ name: "native_watch_install", argumentsText: JSON.stringify({ match: { role: "window" }, action: "notify" }) }] },
        { assistantContent: "", toolCalls: [{ name: "native_locate", argumentsText: JSON.stringify({ name: "OK", role: "button" }) }] },
        { assistantContent: "", toolCalls: [{ name: "native_invoke", argumentsText: JSON.stringify({ handle: okHandle, pattern: "Invoke", action: "Invoke" }) }] },
        { assistantContent: "", toolCalls: [{ name: "native_watch_drain", argumentsText: "{}" }] },
        { assistantContent: "", toolCalls: [{ name: "native_locate", argumentsText: JSON.stringify({ name: "Save changes", role: "window" }) }] },
        { assistantContent: "Verified: OK was invoked and the dialog is gone.", toolCalls: [] },
      ],
      ["native_baseline_capture", "native_watch_install", "native_locate", "native_invoke", "native_watch_drain"],
    );

    expect(score.passed).toBe(true);
    expect(score.score).toBe(1);
  });

  test("passes unsupported_platform recovery when Windows native automation is unavailable", () => {
    const recoveryCase = DEFAULT_MCP_DIALOG_EVAL_CASES.find((testCase) => testCase.id === "desktop-control.unsupported_platform.stop")!;
    const score = scoreMcpDialogEvalCase(
      recoveryCase,
      [
        { assistantContent: "", toolCalls: [{ name: "native_baseline_capture", argumentsText: "{}" }] },
        { assistantContent: "unsupported_platform: Windows UIA automation is unavailable on this host.", toolCalls: [] },
      ],
      ["native_baseline_capture", "native_locate", "native_invoke"],
    );

    expect(score.passed).toBe(true);
  });
});
