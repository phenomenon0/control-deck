/**
 * MCP Streamable HTTP transport endpoint.
 *
 * External agent runtimes (Claude Code, Cursor, Continue, Zed, Windsurf, Codex)
 * that speak MCP can connect here to invoke Control Deck's bridge tools —
 * inheriting the DECK_TOKEN auth from middleware.ts and the approval gate
 * from bridgeDispatch.
 */

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createDeckMcpServer } from "@/lib/mcp/server";
import { generateId } from "@/lib/agui/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Per-request transport to avoid Next.js hot-reload gotcha where module
// reloads orphan old connections. Each request gets its own transport + server
// instance — simpler and safer than module-scoped singletons in Next.js.
// Session IDs are derived from the MCP transport's session header per the spec.
function getTransport(req: Request): WebStandardStreamableHTTPServerTransport {
  // Extract session ID from MCP transport header (if client supports it)
  // This allows clients to correlate requests across a session
  const sessionId = req.headers.get("mcp-session-id") ?? generateId();

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => sessionId,
  });
  const server = createDeckMcpServer();
  void server.connect(transport); // Fire-and-forget, server lives for request duration
  return transport;
}

async function handle(req: Request): Promise<Response> {
  const transport = getTransport(req);
  return transport.handleRequest(req);
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
