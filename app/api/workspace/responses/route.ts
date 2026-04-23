import { NextRequest } from "next/server";
import { submitResponse } from "@/lib/workspace/command-relay";

export const runtime = "nodejs";

/**
 * POST /api/workspace/responses
 *
 * Client (WorkspaceShell) POSTs here after executing a query command
 * delivered via the SSE relay. The server-side pending Promise in
 * command-relay resolves with the data.
 *
 * Body shape:
 *   { id: "q_...", data?: unknown, error?: string }
 */
export async function POST(req: NextRequest): Promise<Response> {
  let body: { id?: string; data?: unknown; error?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  if (!body.id || typeof body.id !== "string") {
    return Response.json({ ok: false, error: "id required" }, { status: 400 });
  }

  const ok = submitResponse(body.id, body.data, body.error);
  if (!ok) {
    // Either the id was never issued or the promise already resolved
    // (client double-submitted, or the agent gave up first). Return
    // 404 so the client can log the drift without retrying.
    return Response.json({ ok: false, error: "no pending query for that id" }, { status: 404 });
  }
  return Response.json({ ok: true });
}
