# MCP workspace relay fixes

## Problem

The `/deck/workspace` browser client subscribes to the workspace command relay in the Next.js server process. A stdio MCP server is launched by an external client as a separate child process. If that stdio process calls `bridgeDispatch` directly, workspace commands publish into a process-local relay with no browser subscribers, so tools such as `workspace_list_panes` time out even while `/deck/workspace` is open.

## Option 1: stdio MCP proxies through the Next.js bridge

Status: implemented.

The stdio MCP entry point passes a bridge URL into `createDeckMcpServer`:

```ts
createDeckMcpServer({
  name: "control-deck",
  threadIdForSession: `mcp:stdio:${process.pid}`,
  bridgeUrl: process.env.CONTROL_DECK_TOOL_BRIDGE_URL ?? "http://localhost:3333/api/tools/bridge",
});
```

When `bridgeUrl` is present, MCP tool calls POST to the Next.js bridge instead of calling `bridgeDispatch` in the stdio process:

```http
POST /api/tools/bridge
Content-Type: application/json

{
  "tool": "workspace_list_panes",
  "args": {},
  "ctx": {
    "thread_id": "mcp:stdio:...",
    "run_id": "...",
    "tool_call_id": "..."
  }
}
```

Why this works:

- `/api/tools/bridge` runs inside the Next.js process.
- The workspace browser tab is subscribed to the relay in that same process.
- Existing Hermes stdio MCP config keeps working.
- The behavior matches direct bridge calls used by Agent-GO and internal UI flows.

Verification:

```bash
bun run typecheck
bun test lib/mcp/http-bridge.test.ts
MCPORTER_CALL_TIMEOUT=30000 npx mcporter call \
  --stdio /home/omen/Documents/INIT/control-deck/scripts/mcp-stdio-wrapper.sh \
  workspace_list_panes \
  --args '{}' \
  --output json
```

Expected result: a JSON pane list, not `workspace query query:list_panes timed out`.

## Option 2: use HTTP MCP from Hermes

Status: documented for later; not implemented in this change.

Goal: configure Hermes to connect to Control Deck via Streamable HTTP MCP instead of stdio:

```yaml
mcp_servers:
  control_deck:
    url: http://127.0.0.1:3333/api/mcp
    timeout: 120
    connect_timeout: 60
```

With auth:

```yaml
mcp_servers:
  control_deck:
    url: http://127.0.0.1:3333/api/mcp
    headers:
      Authorization: Bearer ${DECK_TOKEN}
    timeout: 120
    connect_timeout: 60
```

Current blocker observed:

```text
Bad Request: Server not initialized
```

Likely root cause: `app/api/mcp/route.ts` creates a new Streamable HTTP transport/server per request. MCP HTTP clients initialize a session and then make later list/call requests; if each request receives a fresh server/transport, session initialization state is lost.

Recommended implementation:

1. Keep a module-level session registry in `app/api/mcp/route.ts`:

```ts
type McpHttpSession = {
  server: McpServer;
  transport: WebStandardStreamableHTTPServerTransport;
  lastSeen: number;
};

const sessions = new Map<string, McpHttpSession>();
```

2. Resolve the session id from `mcp-session-id`; create a new id for initialize requests only.
3. Reuse the same server and transport for all requests with the same session id.
4. Delete the session on DELETE.
5. Add idle cleanup to prevent stale sessions.
6. Ensure the route still runs in the Next.js process so workspace tools publish into the same relay as `/deck/workspace`.

Why this is cleaner long-term:

- No child stdio process for Control Deck MCP.
- MCP tool execution naturally shares Next.js process-local state.
- Browser workspace, approvals, runs, and MCP tool calls all live in one process boundary.

Keep Option 1 until Option 2 is verified with a real HTTP MCP client and `workspace_list_panes` returns panes through Hermes native MCP tools.
