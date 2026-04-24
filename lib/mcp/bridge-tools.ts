/**
 * Walk BRIDGE_TOOLS and register each as an MCP tool on the given server.
 * Descriptions come from TOOL_DEFINITIONS; input schemas come from
 * TOOL_SCHEMAS when available (the native_/workspace_ tools don't have
 * runtime zod schemas yet — they fall back to passthrough). bridgeDispatch
 * runs a second round of validation server-side for defense-in-depth.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodObject, ZodRawShape } from "zod";
import { BRIDGE_TOOLS } from "@/lib/tools/bridgeDispatch";
import {
  TOOL_DEFINITIONS,
  TOOL_SCHEMAS,
  type ToolName,
} from "@/lib/tools/definitions";
import { callBridgeToolForMcp } from "./dispatch";

export interface RegisterBridgeToolsOptions {
  threadIdForSession?: string;
}

export function registerBridgeTools(
  server: McpServer,
  opts: RegisterBridgeToolsOptions = {},
): void {
  const byName = new Map<string, (typeof TOOL_DEFINITIONS)[number]>();
  for (const def of TOOL_DEFINITIONS) byName.set(def.name, def);

  for (const toolName of BRIDGE_TOOLS) {
    const def = byName.get(toolName as ToolName);
    const description = def?.description ?? `Bridge tool: ${toolName}`;
    const zodSchema = TOOL_SCHEMAS[toolName as ToolName];

    // The MCP SDK's registerTool takes a ZodRawShape (the inside of z.object)
    // OR a full schema. Our TOOL_SCHEMAS entries are ZodObjects — expose their
    // .shape so the SDK can introspect individual fields for the client.
    const rawShape: ZodRawShape | undefined =
      zodSchema && typeof (zodSchema as ZodObject<ZodRawShape>).shape === "object"
        ? (zodSchema as ZodObject<ZodRawShape>).shape
        : undefined;

    const handler = async (args: Record<string, unknown> | undefined) => {
      return callBridgeToolForMcp(toolName, args ?? {}, {
        threadId: opts.threadIdForSession,
      });
    };

    if (rawShape) {
      // Typed path: SDK will validate args against the shape before calling.
      server.registerTool(
        toolName,
        { description, inputSchema: rawShape },
        handler as Parameters<typeof server.registerTool>[2],
      );
    } else {
      // Untyped path: pass-through. bridgeDispatch still validates.
      server.registerTool(
        toolName,
        { description },
        handler as Parameters<typeof server.registerTool>[2],
      );
    }
  }
}
