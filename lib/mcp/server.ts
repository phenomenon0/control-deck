/**
 * Factory for a Control Deck MCP server exposing the bridge tool surface.
 *
 * Each transport (HTTP+SSE, stdio) gets its own server instance. The
 * underlying tool executor, approvals gate, and SQLite are process-shared.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerBridgeTools, type RegisterBridgeToolsOptions } from "./bridge-tools";
import { registerDeckMcpPrompts, type RegisterDeckMcpPromptsOptions } from "./prompts";
import { registerDeckMcpResources, type RegisterDeckMcpResourcesOptions } from "./resources";

export interface CreateDeckMcpServerOptions
  extends RegisterBridgeToolsOptions,
    RegisterDeckMcpPromptsOptions,
    Pick<RegisterDeckMcpResourcesOptions, "deckUrl" | "workspaceUrl" | "readWorkspaceState"> {
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
        prompts: {},
        resources: {},
      },
    },
  );

  registerDeckMcpPrompts(server, {
    profiles: opts.profiles,
  });
  registerDeckMcpResources(server, {
    profiles: opts.profiles,
    bridgeUrl: opts.bridgeUrl,
    deckUrl: opts.deckUrl,
    workspaceUrl: opts.workspaceUrl,
    readWorkspaceState: opts.readWorkspaceState,
  });

  registerBridgeTools(server, {
    threadIdForSession: opts.threadIdForSession,
    bridgeUrl: opts.bridgeUrl,
    profiles: opts.profiles,
  });

  return server;
}
