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
});
