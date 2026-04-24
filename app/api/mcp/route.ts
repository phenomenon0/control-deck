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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Module-scoped so the MCP server/transport survive across requests in a
// single Next.js worker. Stateless transport (no sessionIdGenerator) keeps
// each client's requests independent — simpler than managing session TTLs.
let transportPromise: Promise<WebStandardStreamableHTTPServerTransport> | null = null;

function getTransport(): Promise<WebStandardStreamableHTTPServerTransport> {
  if (transportPromise) return transportPromise;
  transportPromise = (async () => {
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    const server = createDeckMcpServer();
    await server.connect(transport);
    return transport;
  })();
  return transportPromise;
}

async function handle(req: Request): Promise<Response> {
  const transport = await getTransport();
  return transport.handleRequest(req);
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
