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
