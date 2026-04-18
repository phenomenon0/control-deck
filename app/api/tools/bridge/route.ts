/**
 * Tool Bridge API - Agent-GO to Control-Deck Tool Gateway
 * 
 * Single endpoint that Agent-GO calls to execute UI-specific tools:
 * - generate_image (ComfyUI / Lite pipeline)
 * - edit_image (ComfyUI Qwen Edit)
 * - generate_audio (ComfyUI Stable Audio)
 * - image_to_3d (ComfyUI Hunyuan 3D)
 * - analyze_image (Ollama Vision)
 * - glyph_motif (Procedural SVG)
 * - execute_code (Sandboxed code execution)
 * - vector_search (Semantic search with hybrid mode)
 * - vector_store (Store documents with auto-chunking)
 * - vector_ingest (Ingest URLs with auto-chunking)
 * 
 * Agent-GO native tools (web_search, workspace_search) are NOT routed here.
 */

import { executeToolWithGlyph, type ExecutorContext } from "@/lib/tools/executor";
import type { ToolCall, ToolName } from "@/lib/tools/definitions";
import { hub } from "@/lib/agui/hub";
import { createEvent, generateId, type ArtifactCreated } from "@/lib/agui/events";
import { saveEvent, createArtifact } from "@/lib/agui/db";

// Tools that can be executed via bridge
const BRIDGE_TOOLS = new Set<string>([
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
  "live.play",
  "live.set_track",
  "live.apply_script",
  "live.fx",
  "live.load_sample",
  "live.generate_sample",
  "live.bpm",
]);

interface BridgeRequest {
  /** Tool name */
  tool: string;
  /** Tool arguments */
  args: Record<string, unknown>;
  /** Execution context from Agent-GO */
  ctx: {
    thread_id: string;
    run_id: string;
    tool_call_id?: string;
  };
}

interface BridgeResponse {
  success: boolean;
  message: string;
  /** Artifacts created (images, audio, etc.) */
  artifacts?: Array<{
    id: string;
    url: string;
    name: string;
    mimeType: string;
  }>;
  /** Raw data for LLM context */
  data?: unknown;
  /** Error message if failed */
  error?: string;
}

export async function POST(req: Request): Promise<Response> {
  let body: BridgeRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { success: false, error: "Invalid JSON body" } as BridgeResponse,
      { status: 400 }
    );
  }

  const { tool, args, ctx } = body;

  // Validate request
  if (!tool || typeof tool !== "string") {
    return Response.json(
      { success: false, error: "tool name is required" } as BridgeResponse,
      { status: 400 }
    );
  }

  if (!ctx?.thread_id || !ctx?.run_id) {
    return Response.json(
      { success: false, error: "ctx.thread_id and ctx.run_id are required" } as BridgeResponse,
      { status: 400 }
    );
  }

  // Check if tool is allowed via bridge
  if (!BRIDGE_TOOLS.has(tool)) {
    return Response.json(
      { 
        success: false, 
        error: `Tool '${tool}' is not available via bridge. Use Agent-GO native tools.` 
      } as BridgeResponse,
      { status: 400 }
    );
  }

  console.log(`[Bridge] Executing tool: ${tool}`, args);

  // Build executor context
  const execCtx: ExecutorContext = {
    threadId: ctx.thread_id,
    runId: ctx.run_id,
    toolCallId: ctx.tool_call_id ?? generateId(),
  };

  try {
    // Execute tool - cast to the expected union type
    // The executor will validate and handle unknown tools
    const toolCall = {
      name: tool,
      args: args,
    } as ToolCall;

    const result = await executeToolWithGlyph(toolCall, execCtx);

    console.log(`[Bridge] Tool ${tool} completed: success=${result.success}`);

    // Return result to Agent-GO
    const response: BridgeResponse = {
      success: result.success,
      message: result.message,
      artifacts: result.artifacts,
      data: result.data,
      error: result.error,
    };

    return Response.json(response);

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    console.error(`[Bridge] Tool ${tool} failed:`, error);

    return Response.json(
      { success: false, error: errMsg } as BridgeResponse,
      { status: 500 }
    );
  }
}

/**
 * GET /api/tools/bridge - List available bridge tools
 */
export async function GET(): Promise<Response> {
  return Response.json({
    tools: Array.from(BRIDGE_TOOLS),
    description: "Tools available via Agent-GO bridge",
  });
}
