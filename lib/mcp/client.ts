/**
 * MCP client manager — connects Control Deck to external MCP servers.
 *
 * Lifecycle is process-singleton: one Map of running clients keyed by
 * server id. Config persistence lives in lib/agui/db (mcp_servers table);
 * this module is the runtime side.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpServerRow } from "@/lib/agui/db";

export interface DiscoveredTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export type McpServerStatus = "starting" | "ready" | "error" | "stopped";

export interface RunningServer {
  config: McpServerRow;
  client: Client | null;
  tools: DiscoveredTool[];
  status: McpServerStatus;
  error?: string;
  startedAt?: string;
}

class McpClientManager {
  private running = new Map<string, RunningServer>();

  list(): RunningServer[] {
    return Array.from(this.running.values());
  }

  get(id: string): RunningServer | undefined {
    return this.running.get(id);
  }

  async start(config: McpServerRow): Promise<RunningServer> {
    // Reuse an existing ready/starting entry.
    const existing = this.running.get(config.id);
    if (existing && (existing.status === "ready" || existing.status === "starting")) {
      return existing;
    }

    const entry: RunningServer = {
      config,
      client: null,
      tools: [],
      status: "starting",
      startedAt: new Date().toISOString(),
    };
    this.running.set(config.id, entry);

    try {
      const client = new Client(
        { name: "control-deck", version: "0.1.0" },
        { capabilities: {} },
      );

      if (config.transport === "stdio") {
        if (!config.command) {
          throw new Error("stdio transport requires 'command'");
        }
        const transport = new StdioClientTransport({
          command: config.command,
          args: config.args ?? undefined,
          env: config.env ?? undefined,
          cwd: config.cwd ?? undefined,
        });
        await client.connect(transport);
      } else {
        if (!config.url) {
          throw new Error("http transport requires 'url'");
        }
        const transport = new StreamableHTTPClientTransport(new URL(config.url), {
          requestInit: config.headers
            ? { headers: config.headers as Record<string, string> }
            : undefined,
        });
        await client.connect(transport);
      }

      const { tools } = await client.listTools();
      entry.client = client;
      entry.tools = tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
      entry.status = "ready";
      return entry;
    } catch (err) {
      entry.status = "error";
      entry.error = err instanceof Error ? err.message : String(err);
      return entry;
    }
  }

  async stop(id: string): Promise<void> {
    const entry = this.running.get(id);
    if (!entry) return;
    try {
      await entry.client?.close();
    } catch {
      // swallow; we're tearing down anyway
    }
    entry.client = null;
    entry.status = "stopped";
    this.running.delete(id);
  }

  async callTool(
    id: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const entry = this.running.get(id);
    if (!entry || !entry.client || entry.status !== "ready") {
      throw new Error(`MCP server '${id}' is not ready`);
    }
    return entry.client.callTool({ name: toolName, arguments: args });
  }
}

// Module-level singleton. Survives the life of the Next.js worker.
declare global {
  // eslint-disable-next-line no-var
  var __deckMcpClientManager: McpClientManager | undefined;
}

export function getMcpClientManager(): McpClientManager {
  if (!globalThis.__deckMcpClientManager) {
    globalThis.__deckMcpClientManager = new McpClientManager();
  }
  return globalThis.__deckMcpClientManager;
}
