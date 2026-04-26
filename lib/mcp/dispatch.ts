/**
 * MCP-facing wrapper around bridgeDispatch.
 *
 * MCP tool calls have no native threadId/runId concept, so we mint them
 * per call and record the run in SQLite — that lets externally-triggered
 * tool calls show up in RunsPane alongside native runs, and inherit the
 * same approval gate by going through bridgeDispatch.
 *
 * Thread IDs are now derived from the MCP session ID (if available from
 * the transport header), giving each external agent its own thread in RunsPane.
 * Falls back to "mcp:external" for clients that don't send session IDs.
 */

import { bridgeDispatch } from "@/lib/tools/bridgeDispatch";
import { generateId } from "@/lib/agui/events";
import { createRun, finishRun, errorRun } from "@/lib/agui/db";

export interface McpToolContent {
  type: "text";
  text: string;
}

export interface McpToolResult {
  content: McpToolContent[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

export interface McpDispatchOptions {
  /** Stable thread key per MCP session; defaults to "mcp:external" if no session. */
  threadId?: string;
  /** Optional session ID from MCP transport header for thread derivation. */
  sessionId?: string;
}

export async function callBridgeToolForMcp(
  toolName: string,
  args: Record<string, unknown>,
  opts: McpDispatchOptions = {},
): Promise<McpToolResult> {
  // Derive threadId from MCP session ID if provided, otherwise use default
  const sessionId = opts.sessionId ?? opts.threadId;
  const threadId = sessionId ? `mcp:${sessionId}` : "mcp:external";
  const runId = generateId();
  const toolCallId = generateId();

  createRun(runId, threadId, "mcp:" + toolName);

  const outcome = await bridgeDispatch({
    tool: toolName,
    args,
    threadId,
    runId,
    toolCallId,
  });

  switch (outcome.kind) {
    case "bad_request":
      errorRun(runId, outcome.message);
      return {
        content: [{ type: "text", text: `bad request: ${outcome.message}` }],
        isError: true,
        structuredContent: { error: outcome.message, issues: outcome.issues },
      };
    case "denied":
      errorRun(runId, outcome.reason);
      return {
        content: [{ type: "text", text: `tool call denied: ${outcome.reason}` }],
        isError: true,
        structuredContent: { error: outcome.reason },
      };
    case "error":
      errorRun(runId, outcome.message);
      return {
        content: [{ type: "text", text: `error: ${outcome.message}` }],
        isError: true,
        structuredContent: { error: outcome.message },
      };
    case "ok": {
      finishRun(runId, 0, 0, 0);
      const r = outcome.result;
      const text = r.success
        ? r.message || "ok"
        : r.error || r.message || "failed";

      const structured: Record<string, unknown> = {};
      if (r.data !== undefined) structured.data = r.data;
      if (r.artifacts && r.artifacts.length > 0) {
        structured.artifacts = r.artifacts;
      }

      const result: McpToolResult = {
        content: [{ type: "text", text }],
        isError: !r.success,
      };
      if (Object.keys(structured).length > 0) {
        result.structuredContent = structured;
      }
      return result;
    }
  }
}
