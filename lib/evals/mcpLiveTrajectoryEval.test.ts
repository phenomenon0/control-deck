import { describe, expect, test } from "bun:test";
import {
  buildWorkspaceMacroLiveTrajectoryCase,
  runLiveTrajectoryCase,
  scoreLiveTrajectoryCase,
} from "./mcpLiveTrajectoryEval";

describe("mcp live trajectory eval", () => {
  test("records and scores a verified workspace macro trajectory", async () => {
    const testCase = buildWorkspaceMacroLiveTrajectoryCase("live-marker-123");
    const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];

    const events = await runLiveTrajectoryCase(testCase, async (request) => {
      calls.push(request);
      if (request.tool === "workspace_show_canvas") {
        return { success: true, data: { loaded: true, target: "canvas:default" } };
      }
      return {
        success: true,
        data: {
          verified: true,
          target: "notes:default",
          verifyResult: "existing notes\nlive-marker-123",
        },
      };
    });

    expect(calls.map((call) => call.tool)).toEqual(["workspace_show_canvas", "workspace_write_note"]);
    expect(events).toHaveLength(2);
    expect(events[0].durationMs).toBeGreaterThanOrEqual(0);

    const score = scoreLiveTrajectoryCase(testCase, events);
    expect(score.passed).toBe(true);
    expect(score.score).toBe(1);
  });

  test("fails when the note macro write is not verified", async () => {
    const testCase = buildWorkspaceMacroLiveTrajectoryCase("missing-marker");
    const events = await runLiveTrajectoryCase(testCase, async (request) => {
      if (request.tool === "workspace_show_canvas") {
        return { success: true, data: { loaded: true } };
      }
      return { success: true, data: { verified: false, verifyResult: "old note" } };
    });

    const score = scoreLiveTrajectoryCase(testCase, events);
    expect(score.passed).toBe(false);
    expect(score.reasons.join("\n")).toContain("data.verified expected true");
    expect(score.reasons.join("\n")).toContain("data.verifyResult expected to contain missing-marker");
  });

  test("preserves bridge failure envelopes in the trajectory", async () => {
    const testCase = buildWorkspaceMacroLiveTrajectoryCase("marker");
    const events = await runLiveTrajectoryCase(testCase, async () => ({
      success: false,
      error_code: "workspace_not_open",
      recovery: ["Open /deck/workspace"],
    }));

    expect(events[0].success).toBe(false);
    expect(events[0].error_code).toBe("workspace_not_open");
    const score = scoreLiveTrajectoryCase(testCase, events);
    expect(score.passed).toBe(false);
    expect(score.reasons.join("\n")).toContain("workspace_not_open");
  });
});
