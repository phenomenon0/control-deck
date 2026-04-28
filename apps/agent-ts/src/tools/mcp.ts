/**
 * MCP tools — discover + invoke deck-side MCP servers via /api/mcp/tools.
 *
 * The deck owns the MCP client manager (lib/mcp/client.ts). agent-ts treats
 * each ready external MCP server's tools as plain agent tools by:
 *   1. GET  ${mcpUrl}        → fetch namespaced tool list
 *   2. POST ${mcpUrl} {tool,args} → invoke a single tool and return its result
 *
 * Mirrors the bridge.ts pattern. The qualified MCP tool name (e.g.
 * `mcp:github:list_issues`) is rewritten to a sanitised agent tool name
 * because some LLM tool-calling specs reject ":" in tool names.
 */

import type { TSchema, Static } from "typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";

interface NamespacedToolWire {
  qualifiedName: string;
  toolName: string;
  serverId: string;
  serverName: string;
  description?: string;
  inputSchema?: unknown;
}

interface ListResponse {
  tools?: NamespacedToolWire[];
}

interface InvokeResponse {
  result?: unknown;
  error?: string;
}

interface McpResultContentText {
  type: "text";
  text: string;
}

interface McpResultContentImage {
  type: "image";
  data: string;
  mimeType: string;
}

type McpResultContent =
  | McpResultContentText
  | McpResultContentImage
  | { type: string; [key: string]: unknown };

interface McpCallResult {
  content?: McpResultContent[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

export interface McpContext {
  /** Absolute URL of /api/mcp/tools on the deck. */
  mcpUrl: string;
  threadId: string;
  runId: string;
}

type AnyTool = AgentTool<TSchema, unknown>;

const FALLBACK_SCHEMA: TSchema = {
  type: "object",
  properties: {},
  additionalProperties: true,
} as unknown as TSchema;

/**
 * "mcp:server:tool" → "mcp__server__tool". Some providers (OpenAI tools API)
 * reject ":" in function names; "__" is safe across every spec we ship to.
 * We carry the original qualifiedName separately so the dispatch endpoint
 * still receives the canonical "mcp:" form.
 */
function safeName(qualifiedName: string): string {
  return qualifiedName.replace(/:/g, "__");
}

export async function discoverMcpTools(ctx: McpContext): Promise<AnyTool[]> {
  let res: Response;
  try {
    res = await fetch(ctx.mcpUrl, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[agent-ts] MCP discovery failed: ${msg}`);
    return [];
  }
  if (!res.ok) {
    console.warn(`[agent-ts] MCP discovery returned ${res.status}`);
    return [];
  }
  const data = (await res.json().catch(() => ({}))) as ListResponse;
  const list = data.tools ?? [];
  return list.map((t) => buildMcpTool(t, ctx));
}

function buildMcpTool(meta: NamespacedToolWire, ctx: McpContext): AnyTool {
  const parameters = (meta.inputSchema as TSchema | undefined) ?? FALLBACK_SCHEMA;
  const name = safeName(meta.qualifiedName);
  const label = `${meta.serverName}: ${meta.toolName}`;
  const description =
    meta.description ?? `MCP tool ${meta.toolName} on server ${meta.serverName}`;

  return {
    name,
    label,
    description,
    parameters,
    async execute(
      _toolCallId: string,
      args: Static<TSchema>,
      signal?: AbortSignal,
    ): Promise<AgentToolResult<unknown>> {
      let res: Response;
      try {
        res = await fetch(ctx.mcpUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tool: meta.qualifiedName,
            args: args ?? {},
          }),
          signal,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`mcp dispatch failed (${meta.qualifiedName}): ${msg}`);
      }

      const text = await res.text();
      let parsed: InvokeResponse;
      try {
        parsed = JSON.parse(text) as InvokeResponse;
      } catch {
        throw new Error(
          `mcp dispatch ${meta.qualifiedName} returned non-JSON (status ${res.status}): ${text.slice(0, 200)}`,
        );
      }

      if (!res.ok || parsed.error) {
        throw new Error(
          `mcp ${meta.qualifiedName} failed: ${parsed.error ?? `HTTP ${res.status}`}`,
        );
      }

      const result = (parsed.result ?? {}) as McpCallResult;
      const content = normaliseContent(result.content);
      return {
        content,
        details: {
          tool: meta.qualifiedName,
          serverId: meta.serverId,
          isError: result.isError ?? false,
          structuredContent: result.structuredContent,
        },
      };
    },
  };
}

function normaliseContent(
  content: McpResultContent[] | undefined,
): AgentToolResult<unknown>["content"] {
  if (!content || content.length === 0) {
    return [{ type: "text", text: "(empty result)" }];
  }
  const out: AgentToolResult<unknown>["content"] = [];
  for (const part of content) {
    if (part.type === "text" && typeof (part as McpResultContentText).text === "string") {
      out.push({ type: "text", text: (part as McpResultContentText).text });
    } else if (
      part.type === "image" &&
      typeof (part as McpResultContentImage).data === "string"
    ) {
      const img = part as McpResultContentImage;
      out.push({ type: "image", data: img.data, mimeType: img.mimeType });
    } else {
      // Fallback: serialise unknown parts as text so the model sees something.
      out.push({ type: "text", text: JSON.stringify(part) });
    }
  }
  return out;
}
