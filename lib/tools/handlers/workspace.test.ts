import { afterAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as actualRelay from "@/lib/workspace/command-relay";
import { fingerprint, fromJsonLoose } from "cowrie-glyph";

type RelayCall = { command: string; args: Record<string, unknown>; timeoutMs?: number };

const relayState: {
  calls: RelayCall[];
  next: unknown[];
} = {
  calls: [],
  next: [],
};

/** F1: how many workspace tabs the mocked relay pretends are connected. */
const subscriberState = { count: 1 };

// Spies on the real relay module, not mock.module: bun module mocks are
// process-global and cannot be undone, so they leak into later test files.
// Spies keep the real export shape and mock.restore() reverts them.
const publishCommandSpy = spyOn(actualRelay, "publishCommand").mockImplementation(
  ((cmd: { command: string; args: Record<string, unknown> }) => ({
    id: "cmd_test",
    at: 1,
    ...cmd,
  })) as never,
);
const publishQueryMock = spyOn(actualRelay, "publishQuery").mockImplementation(
  ((command: string, args: Record<string, unknown>, timeoutMs?: number) => {
    relayState.calls.push({ command, args, timeoutMs });
    const value = relayState.next.shift();
    if (value instanceof Error) return Promise.reject(value);
    return Promise.resolve(value);
  }) as never,
);
const subscriberCountSpy = spyOn(actualRelay, "subscriberCount").mockImplementation(
  (() => subscriberState.count) as never,
);

const {
  executeWorkspaceGetState,
  executeWorkspaceListPanes,
  executeWorkspacePaneCall,
  executeWorkspaceWriteNote,
  executeWorkspaceShowCanvas,
  executeWorkspaceOpenPane,
  executeWorkspaceClosePane,
  executeWorkspaceFocusPane,
  executeWorkspaceReset,
} = await import("./workspace");

beforeEach(() => {
  relayState.calls = [];
  relayState.next = [];
  subscriberState.count = 1;
  publishQueryMock.mockClear();
  publishCommandSpy.mockClear();
  subscriberCountSpy.mockClear();
});

afterAll(() => {
  // Revert the relay spies so later test files see real behaviour.
  mock.restore();
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
      client: { route: "/v2/workspace", ready: true, panelCount: 1 },
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

  test("workspace_write_note appends to the first notes pane and verifies the write", async () => {
    relayState.next.push(
      {
        snapshotId: "ws_notes_macro",
        workspaceOpen: true,
        paneCount: 1,
        panes: [
          {
            handle: { id: "notes:notes-default", type: "notes", label: "Notes" },
            capabilities: [
              { name: "read_text", description: "Return the full markdown text" },
              { name: "append_text", description: "Append text to the note" },
              { name: "replace_text", description: "Overwrite the note" },
            ],
            topics: [],
            autoThrottled: [],
          },
        ],
      },
      { text: "Existing notes" },
      { appended: true },
      { text: "Existing notes\nHarness online" },
    );

    const out = await executeWorkspaceWriteNote({
      text: "Harness online",
      mode: "append",
      verify: true,
    });

    expect(relayState.calls).toEqual([
      { command: "query:get_state", args: { includeLayout: false }, timeoutMs: 5_000 },
      {
        command: "query:pane_call",
        args: {
          target: "notes:notes-default",
          capability: "read_text",
          args: {},
        },
        timeoutMs: 5_000,
      },
      {
        command: "query:pane_call",
        args: {
          target: "notes:notes-default",
          capability: "append_text",
          args: { text: "Harness online" },
        },
        timeoutMs: 5_000,
      },
      {
        command: "query:pane_call",
        args: {
          target: "notes:notes-default",
          capability: "read_text",
          args: {},
        },
        timeoutMs: 5_000,
      },
    ]);
    expect(out.success).toBe(true);
    expect(out.message).toContain("notes:notes-default");
    expect(out.data).toMatchObject({
      kind: "workspace_write_note",
      target: "notes:notes-default",
      mode: "append",
      verified: true,
    });
  });

  // A notes pane is shared state: the user types in it, another agent writes
  // to it. An agent that composed its text against an older note must not
  // silently overwrite what landed in between — that is a lost update, and the
  // only evidence it happened is the base fingerprint not matching.
  const notesSnapshot = {
    snapshotId: "ws_notes_base",
    workspaceOpen: true,
    paneCount: 1,
    panes: [
      {
        handle: { id: "notes:notes-default", type: "notes", label: "Notes" },
        capabilities: [
          { name: "read_text", description: "Return the full markdown text" },
          { name: "append_text", description: "Append text to the note" },
          { name: "replace_text", description: "Overwrite the note" },
        ],
        topics: [],
        autoThrottled: [],
      },
    ],
  };

  test("workspace_write_note refuses a write whose base fingerprint is stale", async () => {
    relayState.next.push(notesSnapshot, { text: "note the user edited" });

    const out = await executeWorkspaceWriteNote({
      text: "agent text composed against an older note",
      mode: "replace",
      verify: false,
      baseFingerprint: fingerprint(fromJsonLoose("the note the agent read earlier")),
    });

    expect(out.success).toBe(false);
    expect(out.error_code).toBe("workspace_stale_base");
    // The decisive assertion: nothing was written. Two calls — the state query
    // and the read that caught the drift — and no replace_text.
    expect(relayState.calls).toHaveLength(2);
    expect(relayState.calls.every((c) => c.args.capability !== "replace_text")).toBe(true);
    expect(out.data).toMatchObject({
      observedFingerprint: fingerprint(fromJsonLoose("note the user edited")),
    });
  });

  test("workspace_write_note applies a write whose base fingerprint is current, and returns the next base", async () => {
    relayState.next.push(notesSnapshot, { text: "current note" }, { length: 8 });

    const out = await executeWorkspaceWriteNote({
      text: "new note",
      mode: "replace",
      verify: false,
      baseFingerprint: fingerprint(fromJsonLoose("current note")),
    });

    expect(out.success).toBe(true);
    expect(relayState.calls[2]).toMatchObject({
      command: "query:pane_call",
      args: { capability: "replace_text", args: { text: "new note" } },
    });
    // The returned fingerprint is the base for the caller's next write.
    expect(out.data).toMatchObject({ fingerprint: fingerprint(fromJsonLoose("new note")) });
  });

  test("workspace_show_canvas loads markdown into the first canvas pane", async () => {
    relayState.next.push(
      {
        snapshotId: "ws_canvas_macro",
        workspaceOpen: true,
        paneCount: 1,
        panes: [
          {
            handle: { id: "canvas:canvas-default", type: "canvas", label: "Canvas" },
            capabilities: [
              { name: "load_code", description: "Open a code block in the canvas editor" },
              { name: "load_preview", description: "Open an HTML preview" },
              { name: "load_artifact", description: "Open an artifact" },
            ],
            topics: [],
            autoThrottled: [],
          },
        ],
      },
      { loaded: true },
    );

    const out = await executeWorkspaceShowCanvas({
      code: "# Macro progress",
      language: "markdown",
      title: "Macro Progress",
      filename: "macro-progress.md",
      autoRun: false,
    });

    expect(relayState.calls).toEqual([
      { command: "query:get_state", args: { includeLayout: false }, timeoutMs: 5_000 },
      {
        command: "query:pane_call",
        args: {
          target: "canvas:canvas-default",
          capability: "load_code",
          args: {
            code: "# Macro progress",
            language: "markdown",
            title: "Macro Progress",
            filename: "macro-progress.md",
            autoRun: false,
          },
        },
        timeoutMs: 5_000,
      },
    ]);
    expect(out.success).toBe(true);
    expect(out.data).toMatchObject({
      kind: "workspace_show_canvas",
      target: "canvas:canvas-default",
      capability: "load_code",
      loaded: true,
    });
  });

  test("workspace_list_panes returns structured workspace_not_open envelope on timeout", async () => {
    relayState.next.push(
      new Error("workspace query query:list_panes timed out after 5000ms (no client responded — is /v2/workspace open?)"),
    );

    const out = await executeWorkspaceListPanes();

    expect(out.success).toBe(false);
    expect(out.error_code).toBe("workspace_not_open");
    expect(out.safe_to_retry).toBe(true);
    expect(out.recovery).toContain("Open http://localhost:3333/v2/workspace");
    expect(out.data).toMatchObject({
      kind: "workspace_error",
      error_code: "workspace_not_open",
      workspaceOpen: false,
      query: "query:list_panes",
    });
  });

  test("fire-and-forget commands error workspace_not_open with zero subscribers (F1: no fake success)", () => {
    // A queued command with no listening tab is silently dropped; reporting
    // success:true would mislead the agent into chaining doomed calls.
    subscriberState.count = 0;
    const results = [
      executeWorkspaceOpenPane({ type: "notes" }),
      executeWorkspaceClosePane({ paneId: "notes:notes-default" }),
      executeWorkspaceFocusPane({ paneId: "notes:notes-default" }),
      executeWorkspaceReset(),
    ];
    for (const out of results) {
      expect(out.success).toBe(false);
      expect(out.error_code).toBe("workspace_not_open");
      expect(out.safe_to_retry).toBe(true);
    }
  });

  test("fire-and-forget commands queue normally with a live subscriber", () => {
    const out = executeWorkspaceOpenPane({ type: "notes" });
    expect(out.success).toBe(true);
    expect(out.message).toContain("open_pane");
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
