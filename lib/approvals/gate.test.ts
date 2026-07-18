/**
 * Gate unit tests — mock the DB + settings resolver, exercise the four
 * policy modes + perTool override + autoExecute master switch.
 *
 * The polling-wait path is tested via a mock getApproval that flips to
 * "approved" on the third call, proving the gate resolves promptly.
 */

import { afterAll, afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as actualDb from "@/lib/agui/db";
import { hub } from "@/lib/agui/hub";
import * as actualResolve from "@/lib/settings/resolve";

const dbState: {
  nextStatus: Array<"pending" | "approved" | "denied">;
  created: Array<{ id: string; toolName: string }>;
  decided: Array<{ id: string; decision: string }>;
  createThrows: boolean;
} = { nextStatus: [], created: [], decided: [], createThrows: false };

// Spies on the real modules, not mock.module: bun module mocks are
// process-global and cannot be undone (mock.restore() does not revert them),
// so a mocked export shape leaks into every later-evaluated test file.
// Spies mutate the shared module record and mock.restore() reverts them.
const createApprovalSpy = spyOn(actualDb, "createApproval").mockImplementation(
  ((input: { id: string; toolName: string }) => {
    if (dbState.createThrows) throw new Error("db down");
    dbState.created.push({ id: input.id, toolName: input.toolName });
  }) as never,
);
const decideApprovalSpy = spyOn(actualDb, "decideApproval").mockImplementation(
  ((id: string, decision: string) => {
    dbState.decided.push({ id, decision });
  }) as never,
);
const getApprovalSpy = spyOn(actualDb, "getApproval").mockImplementation(
  (() => {
    const status = dbState.nextStatus.shift() ?? "pending";
    return { status };
  }) as never,
);
// warn.ts (imported by gate.ts) must not write warning events to the real DB.
const saveEventSpy = spyOn(actualDb, "saveEvent").mockImplementation((() => {}) as never);

const hubPublishSpy = spyOn(hub, "publish").mockImplementation((() => {}) as never);
const hubSubscribeSpy = spyOn(hub, "subscribe").mockImplementation((() => () => {}) as never);
const hubSubscribeAllSpy = spyOn(hub, "subscribeAll").mockImplementation((() => () => {}) as never);

interface Policy {
  defaultMode: "never" | "ask" | "cost" | "side-effect";
  perTool: Record<string, "never" | "ask" | "cost" | "side-effect">;
  costThresholdUsd: number;
  timeoutSeconds: number;
}
interface Runs {
  autoExecuteTools: boolean;
}
const state: { approval: Policy; runs: Runs; resolveThrows: boolean } = {
  approval: { defaultMode: "ask", perTool: {}, costThresholdUsd: 0.05, timeoutSeconds: 2 },
  runs: { autoExecuteTools: true },
  resolveThrows: false,
};

const resolveSectionSpy = spyOn(actualResolve, "resolveSection").mockImplementation(
  ((s: "approval" | "runs") => {
    if (state.resolveThrows) throw new Error("settings db down");
    return s === "approval" ? state.approval : state.runs;
  }) as never,
);
const resolveAllSpy = spyOn(actualResolve, "resolveAll").mockImplementation(
  (() => ({ approval: state.approval, runs: state.runs })) as never,
);

const { gateToolCall } = await import("./gate");

beforeEach(() => {
  dbState.nextStatus = [];
  dbState.created.length = 0;
  dbState.decided.length = 0;
  dbState.createThrows = false;
  state.approval = { defaultMode: "ask", perTool: {}, costThresholdUsd: 0.05, timeoutSeconds: 2 };
  state.runs = { autoExecuteTools: true };
  state.resolveThrows = false;
});

afterEach(() => {
  createApprovalSpy.mockClear();
  decideApprovalSpy.mockClear();
  getApprovalSpy.mockClear();
  saveEventSpy.mockClear();
  hubPublishSpy.mockClear();
  hubSubscribeSpy.mockClear();
  hubSubscribeAllSpy.mockClear();
  resolveSectionSpy.mockClear();
  resolveAllSpy.mockClear();
});

afterAll(() => {
  // Restore every spy so later test files see the real module behaviour.
  mock.restore();
});

describe("gateToolCall — policy decisions", () => {
  test("mode=never → auto-approve without creating a row", async () => {
    state.approval.defaultMode = "never";
    const verdict = await gateToolCall({ toolName: "web_search", toolArgs: {} });
    expect(verdict.decision).toBe("approved");
    expect(dbState.created).toHaveLength(0);
  });

  test("mode=cost below threshold → auto-approve", async () => {
    state.approval.defaultMode = "cost";
    const verdict = await gateToolCall({
      toolName: "web_search",
      toolArgs: {},
      estimatedCostUsd: 0.001,
    });
    expect(verdict.decision).toBe("approved");
    expect(dbState.created).toHaveLength(0);
  });

  test("mode=side-effect on a non-side-effect tool → auto-approve", async () => {
    state.approval.defaultMode = "side-effect";
    const verdict = await gateToolCall({ toolName: "web_search", toolArgs: {} });
    expect(verdict.decision).toBe("approved");
  });

  test("mode=side-effect on a side-effect tool → gates", async () => {
    state.approval.defaultMode = "side-effect";
    dbState.nextStatus = ["pending", "approved"];
    const verdict = await gateToolCall({
      toolName: "execute_code",
      toolArgs: { language: "python", code: "print(1)" },
    });
    expect(verdict.decision).toBe("approved");
    expect(dbState.created).toHaveLength(1);
  });

  test("perTool override wins over default", async () => {
    state.approval.defaultMode = "never";
    state.approval.perTool = { execute_code: "ask" };
    dbState.nextStatus = ["pending", "approved"];
    const verdict = await gateToolCall({
      toolName: "execute_code",
      toolArgs: {},
    });
    expect(verdict.decision).toBe("approved");
    expect(dbState.created).toHaveLength(1);
  });

  test("autoExecuteTools=false gates every call", async () => {
    state.approval.defaultMode = "never";
    state.runs.autoExecuteTools = false;
    dbState.nextStatus = ["approved"];
    const verdict = await gateToolCall({ toolName: "web_search", toolArgs: {} });
    expect(verdict.decision).toBe("approved");
    expect(dbState.created).toHaveLength(1);
  });
});

describe("gateToolCall — infra faults must not widen permissions", () => {
  // A broken settings store or approvals table is an availability problem,
  // never an authorization grant: side-effect tools fail closed so a DB
  // outage can't be exploited (or stumbled through) into unapproved writes,
  // while read-only tools keep working because blocking pure reads on an
  // approvals outage buys no safety.
  test("settings resolution throws → side-effect tool is DENIED", async () => {
    state.resolveThrows = true;
    const verdict = await gateToolCall({ toolName: "execute_code", toolArgs: {} });
    expect(verdict.decision).toBe("denied");
    expect(verdict.reason).toContain("fail-closed");
  });

  test("settings resolution throws → read-only tool still runs", async () => {
    state.resolveThrows = true;
    const verdict = await gateToolCall({ toolName: "vector_search", toolArgs: {} });
    expect(verdict.decision).toBe("approved");
  });

  test("approval row insert throws → side-effect tool is DENIED", async () => {
    state.approval.defaultMode = "ask";
    dbState.createThrows = true;
    const verdict = await gateToolCall({ toolName: "execute_code", toolArgs: {} });
    expect(verdict.decision).toBe("denied");
    expect(verdict.reason).toContain("fail-closed");
  });

  test("approval row insert throws → read-only tool gated by ask-mode still runs", async () => {
    state.approval.defaultMode = "ask";
    dbState.createThrows = true;
    const verdict = await gateToolCall({ toolName: "vector_search", toolArgs: {} });
    expect(verdict.decision).toBe("approved");
  });
});

describe("gateToolCall — wait behaviour", () => {
  test("resolves to denied when the row flips to denied", async () => {
    state.approval.defaultMode = "ask";
    dbState.nextStatus = ["pending", "denied"];
    const verdict = await gateToolCall({ toolName: "web_search", toolArgs: {} });
    expect(verdict.decision).toBe("denied");
  });

  test("timeout auto-denies and records the decision", async () => {
    state.approval.defaultMode = "ask";
    state.approval.timeoutSeconds = 1;
    // getApproval always returns pending → deadline trips.
    dbState.nextStatus = Array(20).fill("pending");
    const verdict = await gateToolCall({ toolName: "web_search", toolArgs: {} });
    expect(verdict.decision).toBe("denied");
    expect(verdict.reason).toContain("timed out");
    expect(dbState.decided).toHaveLength(1);
    expect(dbState.decided[0].decision).toBe("denied");
  });
});
