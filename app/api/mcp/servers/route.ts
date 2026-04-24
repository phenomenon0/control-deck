/**
 * /api/mcp/servers — CRUD for external MCP server configs.
 *
 *   GET    /api/mcp/servers            → list configs augmented with live status
 *   POST   /api/mcp/servers            → upsert a config (?autoStart=1 to start it)
 *   PATCH  /api/mcp/servers            → lifecycle: { id, action: "start"|"stop"|"restart" }
 *   DELETE /api/mcp/servers?id=<id>    → stop if running, delete config
 *
 * Auth inherits from middleware.ts (DECK_TOKEN bearer).
 */

import { NextResponse } from "next/server";
import {
  upsertMcpServer,
  getMcpServers,
  getMcpServer,
  deleteMcpServer,
  type McpServerRow,
  type McpServerInput,
  type McpTransportKind,
} from "@/lib/agui/db";
import { getMcpClientManager } from "@/lib/mcp/client";

export const runtime = "nodejs";

interface ServerView extends McpServerRow {
  runtime: {
    status: "starting" | "ready" | "error" | "stopped" | "not_started";
    error?: string;
    startedAt?: string;
    tools: Array<{ name: string; description?: string }>;
  };
}

function augmentWithRuntime(cfg: McpServerRow): ServerView {
  const running = getMcpClientManager().get(cfg.id);
  if (!running) {
    return {
      ...cfg,
      runtime: { status: "not_started", tools: [] },
    };
  }
  return {
    ...cfg,
    runtime: {
      status: running.status,
      error: running.error,
      startedAt: running.startedAt,
      tools: running.tools.map((t) => ({ name: t.name, description: t.description })),
    },
  };
}

function validateInput(body: unknown): McpServerInput | { error: string } {
  if (!body || typeof body !== "object") return { error: "body must be an object" };
  const b = body as Record<string, unknown>;
  if (typeof b.id !== "string" || !b.id) return { error: "id required" };
  if (typeof b.name !== "string" || !b.name) return { error: "name required" };
  if (b.transport !== "stdio" && b.transport !== "http") {
    return { error: "transport must be 'stdio' or 'http'" };
  }
  const transport = b.transport as McpTransportKind;
  if (transport === "stdio") {
    if (typeof b.command !== "string" || !b.command) {
      return { error: "stdio transport requires 'command'" };
    }
  } else {
    if (typeof b.url !== "string" || !b.url) {
      return { error: "http transport requires 'url'" };
    }
  }
  return {
    id: b.id,
    name: b.name,
    transport,
    command: typeof b.command === "string" ? b.command : null,
    args: Array.isArray(b.args) && b.args.every((a) => typeof a === "string")
      ? (b.args as string[])
      : null,
    env: b.env && typeof b.env === "object" && !Array.isArray(b.env)
      ? (b.env as Record<string, string>)
      : null,
    cwd: typeof b.cwd === "string" ? b.cwd : null,
    url: typeof b.url === "string" ? b.url : null,
    headers: b.headers && typeof b.headers === "object" && !Array.isArray(b.headers)
      ? (b.headers as Record<string, string>)
      : null,
    enabled: b.enabled === false ? false : true,
  };
}

export async function GET() {
  const rows = getMcpServers();
  return NextResponse.json({ servers: rows.map(augmentWithRuntime) });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const parsed = validateInput(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const row = upsertMcpServer(parsed);

  const url = new URL(req.url);
  const autoStart = url.searchParams.get("autoStart") === "1" || url.searchParams.get("autoStart") === "true";
  if (autoStart && row.enabled) {
    await getMcpClientManager().start(row);
  }
  return NextResponse.json({ server: augmentWithRuntime(row) });
}

export async function PATCH(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const b = (body ?? {}) as { id?: unknown; action?: unknown };
  if (typeof b.id !== "string" || !b.id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  if (b.action !== "start" && b.action !== "stop" && b.action !== "restart") {
    return NextResponse.json(
      { error: "action must be 'start', 'stop', or 'restart'" },
      { status: 400 },
    );
  }
  const cfg = getMcpServer(b.id);
  if (!cfg) return NextResponse.json({ error: "not found" }, { status: 404 });

  const manager = getMcpClientManager();
  if (b.action === "stop") {
    await manager.stop(b.id);
  } else if (b.action === "start") {
    await manager.start(cfg);
  } else {
    await manager.stop(b.id);
    await manager.start(cfg);
  }
  return NextResponse.json({ server: augmentWithRuntime(cfg) });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await getMcpClientManager().stop(id);
  deleteMcpServer(id);
  return NextResponse.json({ ok: true });
}
