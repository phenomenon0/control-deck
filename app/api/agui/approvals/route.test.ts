/**
 * Approvals route tests — covers the passive sweeper + decide/create
 * branches without touching SQLite. Mocks the DB module so we can
 * observe what the route asks it to do, and the settings resolver so
 * we can exercise the timeout fallback.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const dbState: {
  expireCalls: Array<{ ageSeconds: number; reason?: string }>;
  expireResult: number;
  created: Array<{ id: string; toolName: string }>;
  decided: Array<{ id: string; decision: string; note?: string }>;
  approvalsList: Array<{
    id: string;
    status: string;
    tool_args: string;
    tool_name: string;
  }>;
} = {
  expireCalls: [],
  expireResult: 0,
  created: [],
  decided: [],
  approvalsList: [],
};

const dbStubs: Record<string, unknown> = {
  expirePendingApprovals: mock((age: number, reason?: string) => {
    dbState.expireCalls.push({ ageSeconds: age, reason });
    return dbState.expireResult;
  }),
  createApproval: mock((input: { id: string; toolName: string }) => {
    dbState.created.push({ id: input.id, toolName: input.toolName });
  }),
  decideApproval: mock((id: string, decision: string, note?: string) => {
    dbState.decided.push({ id, decision, note });
  }),
  getApprovals: mock(() => dbState.approvalsList),
  getApproval: mock(() => undefined),
};

const dbMock = new Proxy(dbStubs, {
  get(target, prop: string) {
    if (prop in target) return target[prop];
    return mock(() => undefined);
  },
});

mock.module("@/lib/agui/db", () => dbMock);

interface Policy {
  defaultMode: string;
  perTool: Record<string, string>;
  costThresholdUsd: number;
  timeoutSeconds: number;
}
const settingsState: { approval: Policy; throwOnResolve: boolean } = {
  approval: { defaultMode: "ask", perTool: {}, costThresholdUsd: 0, timeoutSeconds: 90 },
  throwOnResolve: false,
};

mock.module("@/lib/settings/resolve", () => ({
  resolveSection: (section: string) => {
    if (settingsState.throwOnResolve) throw new Error("settings unavailable");
    if (section === "approval") return settingsState.approval;
    return {};
  },
}));

const { GET, POST } = await import("./route");

beforeEach(() => {
  dbState.expireCalls.length = 0;
  dbState.expireResult = 0;
  dbState.created.length = 0;
  dbState.decided.length = 0;
  dbState.approvalsList = [
    {
      id: "appr_1",
      status: "pending",
      tool_args: JSON.stringify({ x: 1 }),
      tool_name: "execute_code",
    },
  ];
  settingsState.approval = {
    defaultMode: "ask",
    perTool: {},
    costThresholdUsd: 0,
    timeoutSeconds: 90,
  };
  settingsState.throwOnResolve = false;
});

afterEach(() => {
  for (const k of Object.keys(dbStubs)) {
    (dbStubs[k] as ReturnType<typeof mock>).mockClear();
  }
});

function reqGet(qs = "") {
  return new Request(`http://localhost/api/agui/approvals${qs ? `?${qs}` : ""}`);
}
function reqPost(body: unknown) {
  return new Request("http://localhost/api/agui/approvals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/agui/approvals", () => {
  test("invokes the sweeper with the configured timeout before listing", async () => {
    settingsState.approval.timeoutSeconds = 90;
    const res = await GET(reqGet());
    expect(res.status).toBe(200);
    expect(dbState.expireCalls).toHaveLength(1);
    expect(dbState.expireCalls[0].ageSeconds).toBe(90);
  });

  test("falls back to a default timeout when settings throw", async () => {
    settingsState.throwOnResolve = true;
    const res = await GET(reqGet());
    expect(res.status).toBe(200);
    expect(dbState.expireCalls).toHaveLength(1);
    // Default chosen in route.ts — large enough that no real flow trips it
    // but bounded so misconfigured rows do eventually expire.
    expect(dbState.expireCalls[0].ageSeconds).toBeGreaterThan(0);
  });

  test("returns approvals with parsed tool_args", async () => {
    const res = await GET(reqGet());
    const body = (await res.json()) as { approvals: Array<{ tool_args: unknown }> };
    expect(body.approvals).toHaveLength(1);
    expect(body.approvals[0].tool_args).toEqual({ x: 1 });
  });

  test("filters by status query param", async () => {
    const res = await GET(reqGet("status=pending"));
    expect(res.status).toBe(200);
    // Sweep still runs unconditionally — keeps a stale UI session honest.
    expect(dbState.expireCalls).toHaveLength(1);
  });
});

describe("POST /api/agui/approvals", () => {
  test("decision path persists via decideApproval", async () => {
    const res = await POST(
      reqPost({ id: "appr_1", decision: "approved", note: "looks good" }),
    );
    expect(res.status).toBe(200);
    expect(dbState.decided).toEqual([
      { id: "appr_1", decision: "approved", note: "looks good" },
    ]);
  });

  test("create:true persists via createApproval", async () => {
    const res = await POST(
      reqPost({
        create: true,
        id: "appr_xyz",
        toolName: "execute_code",
        toolArgs: { code: "print(1)" },
      }),
    );
    expect(res.status).toBe(200);
    expect(dbState.created).toEqual([{ id: "appr_xyz", toolName: "execute_code" }]);
  });

  test("rejects malformed bodies", async () => {
    const res = await POST(reqPost({ id: 123, decision: "maybe" }));
    expect(res.status).toBe(400);
    expect(dbState.decided).toHaveLength(0);
  });
});
