import { describe, expect, test } from "bun:test";
import {
  createWorkSimulatorState,
  extractLiveWorkSideEffects,
  LIVE_RUNNABLE_WORK_CASE_IDS,
  simulateWorkToolCall,
} from "./agentWorkSimulator";

describe("extractLiveWorkSideEffects", () => {
  test("reads workspace_show_canvas in the live { data: { ... } } envelope", () => {
    const out = extractLiveWorkSideEffects({
      toolName: "workspace_show_canvas",
      args: { code: "# Status\nQwen work harness online", language: "markdown" },
      result: { success: true, data: { loaded: true, target: "canvas:abc123" } },
    });
    expect(out.artifact).toEqual({ name: "canvas", content: "# Status\nQwen work harness online" });
    expect(out.verification?.target).toBe("canvas:abc123");
    expect(out.verification?.success).toBe(true);
    expect(out.verification?.evidence).toBe("loaded:true");
  });

  test("reads workspace_show_canvas in the scripted flat envelope", () => {
    const out = extractLiveWorkSideEffects({
      toolName: "workspace_show_canvas",
      args: { markdown: "x" },
      result: { success: true, loaded: true, target: "canvas:flat" },
    });
    expect(out.artifact).toEqual({ name: "canvas", content: "x" });
    expect(out.verification?.target).toBe("canvas:flat");
  });

  test("returns no side effects when success is false", () => {
    const out = extractLiveWorkSideEffects({
      toolName: "workspace_show_canvas",
      args: { code: "x" },
      result: { success: false, error_code: "workspace_pane_not_found" },
    });
    expect(out.artifact).toBeUndefined();
    expect(out.verification).toBeUndefined();
  });

  test("workspace_write_note requires verified:true before counting as verification", () => {
    const okResult = { success: true, data: { verified: true, target: "notes:abc" } };
    const verified = extractLiveWorkSideEffects({
      toolName: "workspace_write_note",
      args: { text: "Qwen work harness online" },
      result: okResult,
    });
    expect(verified.artifact).toEqual({ name: "notes", content: "Qwen work harness online" });
    expect(verified.verification?.evidence).toBe("verified:true");

    const unverified = extractLiveWorkSideEffects({
      toolName: "workspace_write_note",
      args: { text: "x" },
      result: { success: true, data: { verified: false } },
    });
    expect(unverified.artifact).toBeUndefined();
    expect(unverified.verification).toBeUndefined();
  });

  test("execute_code with stdout yields a stdout verification only", () => {
    const out = extractLiveWorkSideEffects({
      toolName: "execute_code",
      args: { language: "python", code: "print(191*223)" },
      result: { success: true, stdout: "42593\n", exit_code: 0 },
    });
    expect(out.artifact).toBeUndefined();
    expect(out.verification?.target).toBe("execute_code:stdout");
    expect(out.verification?.evidence?.startsWith("42593")).toBe(true);
  });

  test("unknown tools return no side effects", () => {
    const out = extractLiveWorkSideEffects({
      toolName: "vector_search",
      args: { query: "anything" },
      result: { success: true, hits: [] },
    });
    expect(out.artifact).toBeUndefined();
    expect(out.verification).toBeUndefined();
  });
});

describe("simulateWorkToolCall native Windows cases", () => {
  test("safe_button_invoke_verified emits verification only after invoke closes the dialog", () => {
    const state = createWorkSimulatorState();
    const firstLocate = simulateWorkToolCall({
      caseId: "work.desktop_control.safe_button_invoke_verified",
      toolName: "native_locate",
      args: { name: "OK", role: "button" },
      state,
    });
    expect(firstLocate.result.results).toHaveLength(1);
    expect(firstLocate.verification).toBeUndefined();

    simulateWorkToolCall({
      caseId: "work.desktop_control.safe_button_invoke_verified",
      toolName: "native_invoke",
      args: { handle: { id: "uia:ok" }, pattern: "Invoke" },
      state,
    });
    const secondLocate = simulateWorkToolCall({
      caseId: "work.desktop_control.safe_button_invoke_verified",
      toolName: "native_locate",
      args: { name: "Save changes", role: "window" },
      state,
    });

    expect(secondLocate.result.results).toEqual([]);
    expect(secondLocate.verification).toEqual({
      target: "dialog:Save changes",
      success: true,
      method: "native_locate-absence",
      evidence: "results:[]",
    });
  });

  test("unsupported_platform case returns normalized native error envelopes", () => {
    const out = simulateWorkToolCall({
      caseId: "work.desktop_control.unsupported_platform_stop",
      toolName: "native_baseline_capture",
      args: {},
      state: createWorkSimulatorState(),
    });
    expect(out.result.success).toBe(false);
    expect(out.result.error_code).toBe("unsupported_platform");
  });

  test("restore_after_failed_mutation verifies baseline restore after failed invoke", () => {
    const state = createWorkSimulatorState();
    const failedInvoke = simulateWorkToolCall({
      caseId: "work.desktop_control.restore_after_failed_mutation",
      toolName: "native_invoke",
      args: { handle: { id: "uia:ok" }, pattern: "Invoke" },
      state,
    });
    expect(failedInvoke.result.success).toBe(false);
    expect(failedInvoke.result.error_code).toBe("native_invoke_failed");

    const restored = simulateWorkToolCall({
      caseId: "work.desktop_control.restore_after_failed_mutation",
      toolName: "native_baseline_restore",
      args: {},
      state,
    });
    expect(restored.verification?.target).toBe("native-baseline");
    expect(restored.verification?.evidence).toBe("restored:true");
  });
});

describe("LIVE_RUNNABLE_WORK_CASE_IDS", () => {
  test("excludes fault-injection cases that need scripted observations", () => {
    expect(LIVE_RUNNABLE_WORK_CASE_IDS.has("work.core.recovery.workspace_not_open")).toBe(false);
    expect(LIVE_RUNNABLE_WORK_CASE_IDS.has("work.core.recovery.stale_canvas_retry")).toBe(false);
  });

  test("includes core workspace + developer compute + research + handoff", () => {
    expect(LIVE_RUNNABLE_WORK_CASE_IDS.has("work.core.workspace.status_board_verified")).toBe(true);
    expect(LIVE_RUNNABLE_WORK_CASE_IDS.has("work.developer.compute_verify_report")).toBe(true);
    expect(LIVE_RUNNABLE_WORK_CASE_IDS.has("work.core.research.grounded_summary")).toBe(true);
    expect(LIVE_RUNNABLE_WORK_CASE_IDS.has("work.handoff.plan_test_harness")).toBe(true);
  });
});
