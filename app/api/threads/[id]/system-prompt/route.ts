/**
 * PUT /api/threads/[id]/system-prompt — set or clear a thread's system-prompt override.
 *
 * Body: { prompt: string | null }
 *   - non-empty string: thread uses this instead of the global prefs.systemPrompt
 *   - null or empty string: thread reverts to the global default
 */

import { NextResponse } from "next/server";
import { getThread, updateThreadSystemPrompt } from "@/lib/agui/db";

interface PutBody {
  prompt?: string | null;
}

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!getThread(id)) {
    return NextResponse.json({ error: "thread not found" }, { status: 404 });
  }

  let body: PutBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const raw = body.prompt;
  const next = typeof raw === "string" && raw.trim() ? raw : null;
  updateThreadSystemPrompt(id, next);
  return NextResponse.json({ id, systemPrompt: next });
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const thread = getThread(id);
  if (!thread) return NextResponse.json({ error: "thread not found" }, { status: 404 });
  return NextResponse.json({ id, systemPrompt: thread.system_prompt ?? null });
}
