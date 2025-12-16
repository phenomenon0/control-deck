/**
 * Tool Test Endpoint - For testing tools directly without chat
 * POST /api/tools/test
 * Body: { name: "tool_name", args: { ... } }
 */

import { NextRequest, NextResponse } from "next/server";
import { executeTool, type ExecutorContext } from "@/lib/tools/executor";
import { ToolCallSchema } from "@/lib/tools/definitions";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    
    // Validate tool call
    const parsed = ToolCallSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid tool call", details: parsed.error.format() },
        { status: 400 }
      );
    }
    
    // Create test context
    const ctx: ExecutorContext = {
      runId: `test-${Date.now()}`,
      threadId: "test-thread",
      toolCallId: `tool-${Date.now()}`,
    };
    
    // Execute tool
    const result = await executeTool(parsed.data, ctx);
    
    return NextResponse.json(result);
    
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
