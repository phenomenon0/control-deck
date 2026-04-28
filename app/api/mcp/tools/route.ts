/**
 * /api/mcp/tools — flat list + invoke surface for the agent runtime.
 *
 *   GET  /api/mcp/tools                      → list ready namespaced MCP tools
 *   POST /api/mcp/tools  {tool, args}        → invoke a tool, return MCP result
 *
 * Lets agent-ts (and any other in-process callee) treat the deck's external
 * MCP servers as a flat tool pool without re-implementing the MCP client.
 *
 * Auth inherits from middleware.ts (DECK_TOKEN bearer).
 */

import { NextResponse } from "next/server";
import { listMcpTools, invokeMcpTool, parseQualifiedName } from "@/lib/mcp/registry";

export const runtime = "nodejs";

export async function GET() {
  const tools = listMcpTools();
  return NextResponse.json({ tools });
}

interface InvokeBody {
  tool?: string;
  args?: Record<string, unknown>;
}

export async function POST(req: Request) {
  let body: InvokeBody;
  try {
    body = (await req.json()) as InvokeBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const tool = body.tool;
  if (typeof tool !== "string" || !tool) {
    return NextResponse.json({ error: "tool required" }, { status: 400 });
  }
  const parsed = parseQualifiedName(tool);
  if (!parsed) {
    return NextResponse.json(
      { error: `not an MCP tool name: ${tool}` },
      { status: 400 },
    );
  }

  try {
    const result = await invokeMcpTool(tool, body.args ?? {});
    return NextResponse.json({ result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
