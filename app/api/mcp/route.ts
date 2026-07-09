/**
 * MCP Streamable HTTP transport endpoint.
 *
 * External agent runtimes (Claude Code, Cursor, Continue, Zed, Windsurf, Codex)
 * that speak MCP can connect here to invoke Control Deck's bridge tools —
 * inheriting the DECK_TOKEN auth from middleware.ts and the approval gate
 * from bridgeDispatch.
 *
 * Streamable HTTP is session-stateful: after the client's `initialize` POST
 * the server hands out an `mcp-session-id`, and every subsequent request
 * (notifications/initialized, tools/list, tools/call, the GET SSE stream,
 * DELETE) must hit the SAME McpServer + transport instance. We cache them
 * in a module-scope Map keyed by session id. The Map is parked on
 * globalThis so Next.js HMR doesn't orphan live sessions on every save.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createDeckMcpServer } from "@/lib/mcp/server";
import { generateId } from "@/lib/agui/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface McpSession {
  server: McpServer;
  transport: WebStandardStreamableHTTPServerTransport;
  lastAccess: number;
}

const SESSION_TTL_MS = 60 * 60 * 1000; // 1h idle eviction

const g = globalThis as unknown as {
  __deckMcpSessions?: Map<string, McpSession>;
};
const sessions: Map<string, McpSession> =
  g.__deckMcpSessions ?? (g.__deckMcpSessions = new Map());

function sweepIdleSessions(): void {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [sid, entry] of sessions) {
    if (entry.lastAccess < cutoff) {
      void entry.transport.close();
      sessions.delete(sid);
    }
  }
}

async function getOrCreateSession(req: Request): Promise<McpSession> {
  const headerSid = req.headers.get("mcp-session-id") ?? undefined;
  const existing = headerSid ? sessions.get(headerSid) : undefined;
  if (existing) {
    existing.lastAccess = Date.now();
    return existing;
  }

  // No (or stale) session id → fresh transport. If the request is actually
  // `initialize`, the SDK will mint a session id via sessionIdGenerator and
  // fire onsessioninitialized; we register the entry then. If it's a
  // non-init request with a stale id, the transport's own session validator
  // returns 404 and the entry is never registered, which is correct.
  const server = createDeckMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => generateId(),
    onsessioninitialized: (newSid: string) => {
      sessions.set(newSid, {
        server,
        transport,
        lastAccess: Date.now(),
      });
    },
    onsessionclosed: (closedSid: string) => {
      sessions.delete(closedSid);
    },
  });
  await server.connect(transport);
  return { server, transport, lastAccess: Date.now() };
}

async function handle(req: Request): Promise<Response> {
  sweepIdleSessions();
  const session = await getOrCreateSession(req);
  return session.transport.handleRequest(req);
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
