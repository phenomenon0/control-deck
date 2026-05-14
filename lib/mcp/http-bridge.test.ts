import { describe, expect, test } from "bun:test";
import { callToolBridgeHttp } from "./http-bridge";

describe("callToolBridgeHttp", () => {
  test("posts MCP tool calls to the Next.js bridge with the MCP run context", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({
        success: true,
        message: "Workspace has 2 registered pane(s)",
        data: { panes: [{ handle: { id: "terminal:terminal-default" } }] },
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const result = await callToolBridgeHttp({
      bridgeUrl: "http://localhost:3333/api/tools/bridge",
      tool: "workspace_list_panes",
      args: {},
      threadId: "mcp:stdio:123",
      runId: "run-1",
      toolCallId: "tool-call-1",
      fetchImpl,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("http://localhost:3333/api/tools/bridge");
    expect(requests[0].init.method).toBe("POST");
    expect(requests[0].init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(String(requests[0].init.body))).toEqual({
      tool: "workspace_list_panes",
      args: {},
      ctx: {
        thread_id: "mcp:stdio:123",
        run_id: "run-1",
        tool_call_id: "tool-call-1",
      },
    });
    expect(result).toEqual({
      success: true,
      message: "Workspace has 2 registered pane(s)",
      data: { panes: [{ handle: { id: "terminal:terminal-default" } }] },
    });
  });

  test("can forward MCP source, modality, and profiles through the HTTP bridge context", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ success: true, message: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await callToolBridgeHttp({
      bridgeUrl: "http://localhost:3333/api/tools/bridge",
      tool: "execute_code",
      args: { language: "python", code: "print(1)" },
      threadId: "mcp:stdio:123",
      runId: "run-1",
      toolCallId: "tool-call-1",
      policyCtx: { source: "mcp", modality: "mcp", mcpProfiles: ["developer"] },
      fetchImpl,
    });

    expect(JSON.parse(String(requests[0].init.body))).toEqual({
      tool: "execute_code",
      args: { language: "python", code: "print(1)" },
      ctx: {
        thread_id: "mcp:stdio:123",
        run_id: "run-1",
        tool_call_id: "tool-call-1",
        source: "mcp",
        modality: "mcp",
        mcp_profiles: ["developer"],
      },
    });
  });

  test("preserves normalized tool error envelopes from the HTTP bridge", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({
      success: false,
      message: "No workspace client responded. Open /deck/workspace and retry the workspace operation.",
      error: "workspace query query:get_state timed out after 5000ms (no client responded — is /deck/workspace open?)",
      error_code: "workspace_not_open",
      recovery: ["Open http://localhost:3333/deck/workspace", "Retry workspace_get_state before any workspace write"],
      safe_to_retry: true,
      data: { kind: "workspace_error", error_code: "workspace_not_open", workspaceOpen: false },
    }), { status: 200, headers: { "content-type": "application/json" } });

    const result = await callToolBridgeHttp({
      bridgeUrl: "http://localhost:3333/api/tools/bridge",
      tool: "workspace_get_state",
      args: { includeLayout: false },
      threadId: "mcp:stdio:123",
      runId: "run-1",
      toolCallId: "tool-call-1",
      fetchImpl,
    });

    expect(result).toMatchObject({
      success: false,
      error_code: "workspace_not_open",
      safe_to_retry: true,
      recovery: ["Open http://localhost:3333/deck/workspace", "Retry workspace_get_state before any workspace write"],
      data: { kind: "workspace_error", error_code: "workspace_not_open", workspaceOpen: false },
    });
  });

  test("turns non-2xx bridge responses into failed tool results", async () => {
    const fetchImpl = async () => new Response("nope", { status: 503 });

    const result = await callToolBridgeHttp({
      bridgeUrl: "http://localhost:3333/api/tools/bridge",
      tool: "workspace_list_panes",
      args: {},
      threadId: "mcp:stdio:123",
      runId: "run-1",
      toolCallId: "tool-call-1",
      fetchImpl,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("HTTP bridge returned 503");
    expect(result.error).toContain("nope");
  });
});
