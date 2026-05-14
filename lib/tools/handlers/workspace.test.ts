import { beforeEach, describe, expect, mock, test } from "bun:test";

type RelayCall = { command: string; args: Record<string, unknown>; timeoutMs?: number };

const relayState: {
  calls: RelayCall[];
  next: unknown[];
} = {
  calls: [],
  next: [],
};

const publishQueryMock = mock((command: string, args: Record<string, unknown>, timeoutMs?: number) => {
  relayState.calls.push({ command, args, timeoutMs });
  const value = relayState.next.shift();
  if (value instanceof Error) return Promise.reject(value);
  return Promise.resolve(value);
});

mock.module("@/lib/workspace/command-relay", () => ({
  publishCommand: mock((cmd: { command: string; args: Record<string, unknown> }) => ({
    id: "cmd_test",
    at: 1,
    ...cmd,
  })),
  publishQuery: publishQueryMock,
}));

const {
  executeWorkspaceGetState,
  executeWorkspaceListPanes,
  executeWorkspacePaneCall,
} = await import("./workspace");

beforeEach(() => {
  relayState.calls = [];
  relayState.next = [];
  publishQueryMock.mockClear();
});

describe("workspace tool handlers", () => {
  test("workspace_get_state returns a normalized observe snapshot", async () => {
    relayState.next.push({
      snapshotId: "ws_test_1",
      capturedAt: "2026-05-14T17:00:00.000Z",
      workspaceOpen: true,
      paneCount: 1,
      panes: [
        {
          handle: { id: "notes:notes-default", type: "notes", label: "Notes" },
          capabilities: [{ name: "notes.read_text", description: "Read note text" }],
          topics: [],
          autoThrottled: [],
        },
      ],
      client: { route: "/deck/workspace", ready: true, panelCount: 1 },
    });

    const out = await executeWorkspaceGetState({ includeLayout: false });

    expect(relayState.calls).toEqual([
      { command: "query:get_state", args: { includeLayout: false }, timeoutMs: 5_000 },
    ]);
    expect(out.success).toBe(true);
    expect(out.message).toContain("Workspace state captured");
    expect(out.data).toMatchObject({
      snapshotId: "ws_test_1",
      workspaceOpen: true,
      paneCount: 1,
    });
  });

  test("workspace_list_panes returns structured workspace_not_open envelope on timeout", async () => {
    relayState.next.push(
      new Error("workspace query query:list_panes timed out after 5000ms (no client responded — is /deck/workspace open?)"),
    );

    const out = await executeWorkspaceListPanes();

    expect(out.success).toBe(false);
    expect(out.error_code).toBe("workspace_not_open");
    expect(out.safe_to_retry).toBe(true);
    expect(out.recovery).toContain("Open http://localhost:3333/deck/workspace");
    expect(out.data).toMatchObject({
      kind: "workspace_error",
      error_code: "workspace_not_open",
      workspaceOpen: false,
      query: "query:list_panes",
    });
  });

  test("workspace_pane_call returns stale-handle guidance for missing panes", async () => {
    relayState.next.push(new Error("pane not found: canvas:old-handle"));

    const out = await executeWorkspacePaneCall({
      target: "canvas:old-handle",
      capability: "canvas.load_code",
      args: { title: "x", code: "# x" },
    });

    expect(out.success).toBe(false);
    expect(out.error_code).toBe("workspace_pane_not_found");
    expect(out.safe_to_retry).toBe(true);
    expect(out.recovery).toContain("Call workspace_get_state to refresh pane handles");
    expect(out.data).toMatchObject({
      kind: "workspace_error",
      error_code: "workspace_pane_not_found",
      target: "canvas:old-handle",
      capability: "canvas.load_code",
    });
  });
});
