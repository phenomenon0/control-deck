/**
 * Merged MCP tool registry — surfaces tools discovered across every running
 * external server, namespaced as `mcp:<serverId>:<toolName>`.
 *
 * Phase 1 scope: read-only enumeration for CapabilitiesPane, plus a thin
 * invoke helper for UI test-calls. Integrating into the main chat tool loop
 * is a follow-up.
 */

import { getMcpClientManager, type DiscoveredTool } from "./client";

export interface NamespacedTool {
  /** Full namespaced name, e.g. "mcp:github:list_issues". */
  qualifiedName: string;
  /** Raw tool name as advertised by the remote server. */
  toolName: string;
  /** Owning server id. */
  serverId: string;
  serverName: string;
  description?: string;
  inputSchema?: unknown;
}

export function listMcpTools(): NamespacedTool[] {
  const manager = getMcpClientManager();
  const out: NamespacedTool[] = [];
  for (const server of manager.list()) {
    if (server.status !== "ready") continue;
    for (const t of server.tools) {
      out.push(toNamespaced(server.config.id, server.config.name, t));
    }
  }
  return out;
}

export async function invokeMcpTool(
  qualifiedName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const parsed = parseQualifiedName(qualifiedName);
  if (!parsed) throw new Error(`not an MCP tool name: ${qualifiedName}`);
  return getMcpClientManager().callTool(parsed.serverId, parsed.toolName, args);
}

export function parseQualifiedName(
  name: string,
): { serverId: string; toolName: string } | null {
  if (!name.startsWith("mcp:")) return null;
  const rest = name.slice(4);
  const idx = rest.indexOf(":");
  if (idx <= 0) return null;
  return {
    serverId: rest.slice(0, idx),
    toolName: rest.slice(idx + 1),
  };
}

function toNamespaced(
  serverId: string,
  serverName: string,
  t: DiscoveredTool,
): NamespacedTool {
  return {
    qualifiedName: `mcp:${serverId}:${t.name}`,
    toolName: t.name,
    serverId,
    serverName,
    description: t.description,
    inputSchema: t.inputSchema,
  };
}
