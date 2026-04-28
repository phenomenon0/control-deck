/**
 * Factory for a Control Deck MCP server exposing the bridge tool surface.
 *
 * Each transport (HTTP+SSE, stdio) gets its own server instance. The
 * underlying tool executor, approvals gate, and SQLite are process-shared.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerBridgeTools, type RegisterBridgeToolsOptions } from "./bridge-tools";

export interface CreateDeckMcpServerOptions extends RegisterBridgeToolsOptions {
  name?: string;
  version?: string;
}

export function createDeckMcpServer(
  opts: CreateDeckMcpServerOptions = {},
): McpServer {
  const server = new McpServer(
    {
      name: opts.name ?? "control-deck",
      version: opts.version ?? "0.1.0",
    },
    {
      capabilities: {
        tools: {},
        // Future: sampling, prompts, resources as MCP SDK supports them
      },
    },
  );

  registerBridgeTools(server, {
    threadIdForSession: opts.threadIdForSession,
    bridgeUrl: opts.bridgeUrl,
  });

  return server;
}
