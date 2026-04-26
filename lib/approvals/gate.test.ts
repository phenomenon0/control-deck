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
} = { nextStatus: [], created: [], decided: [] };

const dbStubs: Record<string, unknown> = {
  createApproval: mock((input: { id: string; toolName: string }) => {
    dbState.created.push({ id: input.id, toolName: input.toolName });
  }),
  decideApproval: mock((id: string, decision: string) => {
    dbState.decided.push({ id, decision });
  }),
  getApproval: mock(() => {
    const status = dbState.nextStatus.shift() ?? "pending";
    return { status } as { status: "pending" | "approved" | "denied" };
  }),
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
const state: { approval: Policy; runs: Runs } = {
  approval: { defaultMode: "ask", perTool: {}, costThresholdUsd: 0.05, timeoutSeconds: 2 },
  runs: { autoExecuteTools: true },
};

mock.module("@/lib/settings/resolve", () => ({
  resolveSection: (s: "approval" | "runs") => (s === "approval" ? state.approval : state.runs),
  resolveAll: () => ({ approval: state.approval, runs: state.runs }),
}));

const { gateToolCall } = await import("./gate");

beforeEach(() => {
  dbState.nextStatus = [];
  dbState.created.length = 0;
  dbState.decided.length = 0;
  state.approval = { defaultMode: "ask", perTool: {}, costThresholdUsd: 0.05, timeoutSeconds: 2 };
  state.runs = { autoExecuteTools: true };
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

  test("mode=side-effect gates dot-named live tools", async () => {
    state.approval.defaultMode = "side-effect";
    const liveTools = [
      "live.play",
      "live.set_track",
      "live.apply_script",
      "live.fx",
      "live.load_sample",
      "live.generate_sample",
      "live.bpm",
    ];

    for (const toolName of liveTools) {
      dbState.nextStatus = ["approved"];
      const verdict = await gateToolCall({ toolName, toolArgs: {} });
      expect(verdict.decision).toBe("approved");
    }

    expect(dbState.created.map((row) => row.toolName)).toEqual(liveTools);
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
