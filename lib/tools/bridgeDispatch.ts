/**
 * Shared bridge dispatch — wraps the low-level tool executor with the
 * BRIDGE_TOOLS allowlist, Zod arg validation, and the approvals gate.
 *
 * Entry points that share this:
 *   - POST /api/tools/bridge  (Agent-GO HTTP callback)
 *   - PUT  /api/chat          (manual tool triggers)
 *   - MCP server tools/call   (external agent runtimes via MCP)
 */

import {
  executeToolWithGlyph,
  type ExecutorContext,
  type ToolExecutionResult,
} from "./executor";
import { TOOL_SCHEMAS, type ToolCall, type ToolName } from "./definitions";
import { generateId } from "@/lib/agui/events";
import { gateToolCall } from "@/lib/approvals/gate";

// Agent-GO native tools (web_search, workspace_search) are NOT routed here.
export const BRIDGE_TOOLS = new Set<string>([
  "generate_image",
  "edit_image",
  "generate_audio",
  "image_to_3d",
  "analyze_image",
  "glyph_motif",
  "execute_code",
  "vector_search",
  "vector_store",
  "vector_ingest",
  "native_locate",
  "native_click",
  "native_type",
  "native_tree",
  "native_key",
  "native_focus",
  "native_screen_grab",
  "native_focus_window",
  "native_click_pixel",
  "native_invoke",
  "native_wait_for",
  "native_element_from_point",
  "native_read_text",
  "native_with_cache",
  "native_watch_install",
  "native_watch_drain",
  "native_watch_remove",
  "native_baseline_capture",
  "native_baseline_restore",
  "workspace_open_pane",
  "workspace_close_pane",
  "workspace_focus_pane",
  "workspace_reset",
  "workspace_list_panes",
  "workspace_pane_call",
]);

export interface BridgeDispatchRequest {
  tool: string;
  args: Record<string, unknown>;
  threadId: string;
  runId: string;
  toolCallId?: string;
}

export type BridgeDispatchOutcome =
  | { kind: "ok"; result: ToolExecutionResult }
  | { kind: "bad_request"; message: string; issues?: unknown }
  | { kind: "denied"; reason: string }
  | { kind: "error"; message: string };

export async function bridgeDispatch(
  req: BridgeDispatchRequest,
): Promise<BridgeDispatchOutcome> {
  const { tool, args, threadId, runId } = req;

  if (!tool || typeof tool !== "string") {
    return { kind: "bad_request", message: "tool name is required" };
  }
  if (!threadId || !runId) {
    return { kind: "bad_request", message: "threadId and runId are required" };
  }
  if (!BRIDGE_TOOLS.has(tool)) {
    return {
      kind: "bad_request",
      message: `tool '${tool}' is not available via bridge`,
    };
  }

  const schema = TOOL_SCHEMAS[tool as ToolName];
  let validatedArgs: Record<string, unknown> = args ?? {};
  if (schema) {
    const parsed = schema.safeParse(validatedArgs);
    if (!parsed.success) {
      return {
        kind: "bad_request",
        message: "invalid args",
        issues: parsed.error.issues,
      };
    }
    validatedArgs = parsed.data as Record<string, unknown>;
  } else {
    console.warn("[bridge] no schema for tool:", tool);
  }

  const verdict = await gateToolCall({
    toolName: tool,
    toolArgs: validatedArgs,
    runId,
    threadId,
  });
  if (verdict.decision === "denied") {
    return { kind: "denied", reason: verdict.reason };
  }

  const execCtx: ExecutorContext = {
    threadId,
    runId,
    toolCallId: req.toolCallId ?? generateId(),
  };

  try {
    const result = await executeToolWithGlyph(
      { name: tool, args: validatedArgs } as ToolCall,
      execCtx,
    );
    return { kind: "ok", result };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    console.error(`[bridge] tool ${tool} failed:`, error);
    return { kind: "error", message: errMsg };
  }
}
