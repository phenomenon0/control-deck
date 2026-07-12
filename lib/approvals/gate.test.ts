/**
 * Gate unit tests — mock the DB + settings resolver, exercise the four
 * policy modes + perTool override + autoExecute master switch.
 *
 * The polling-wait path is tested via a mock getApproval that flips to
 * "approved" on the third call, proving the gate resolves promptly.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const dbState: {
  nextStatus: Array<"pending" | "approved" | "denied">;
  created: Array<{ id: string; toolName: string }>;
  decided: Array<{ id: string; decision: string }>;
  createThrows: boolean;
} = { nextStatus: [], created: [], decided: [], createThrows: false };

const dbStubs: Record<string, unknown> = {
  createApproval: mock((input: { id: string; toolName: string }) => {
    if (dbState.createThrows) throw new Error("db down");
    dbState.created.push({ id: input.id, toolName: input.toolName });
  }),
  decideApproval: mock((id: string, decision: string) => {
    dbState.decided.push({ id, decision });
  }),
  getApproval: mock(() => {
    const status = dbState.nextStatus.shift() ?? "pending";
    return { status } as { status: "pending" | "approved" | "denied" };
  }),
  // Named-export resolution doesn't reach the Proxy fallback; warn.ts
  // (imported by gate.ts) needs this binding to exist at module shape.
  saveEvent: mock(() => {}),
};

// Proxy fills in noop stubs for every export gate.ts (or its transitive
// imports) might ask for when the composite bun-test run has already
// loaded the real db module. The spy'd functions above are still returned
// for the three we care about.
const dbMock = new Proxy(dbStubs, {
  get(target, prop: string) {
    if (prop in target) return target[prop];
    // Return a no-op for anything else; type-cast is safe at runtime.
    return mock(() => undefined);
  },
});

mock.module("@/lib/agui/db", () => dbMock);
mock.module("@/lib/agui/hub", () => ({
  hub: { publish: mock(() => {}), subscribe: mock(() => () => {}), subscribeAll: mock(() => () => {}) },
}));

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

mock.module("@/lib/settings/resolve", () => ({
  resolveSection: (s: "approval" | "runs") => {
    if (state.resolveThrows) throw new Error("settings db down");
    return s === "approval" ? state.approval : state.runs;
  },
  resolveAll: () => ({ approval: state.approval, runs: state.runs }),
}));

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
  // Spies are declared inside the Proxy stubs map; reach through.
  (dbStubs.createApproval as ReturnType<typeof mock>).mockClear();
  (dbStubs.decideApproval as ReturnType<typeof mock>).mockClear();
  (dbStubs.getApproval as ReturnType<typeof mock>).mockClear();
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
