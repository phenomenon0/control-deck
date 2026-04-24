/**
 * /api/terminal/agui — Translate scraped terminal output into AG-UI events.
 *
 * TerminalPane posts lifecycle + text deltas here for `claude` / `opencode`
 * profiles. Each live session gets a stable threadId (`terminal:<sid>`)
 * and a run that spans from first output to exit. Events fan out through
 * the hub + persist to SQLite, so terminal sessions appear in the shared
 * timeline alongside chat.
 *
 * Phase 2 scope: coarse transcript. A single TextMessage per run captures
 * the full post-ANSI-strip output. Finer segmentation (tool-call extraction,
 * reasoning chunks) is a later pass once we pick a structured stream mode.
 */

import { NextResponse } from "next/server";
import {
  createEvent,
  createRun,
  createThread,
  errorRun,
  finishRun,
  generateId,
  getDb,
  hub,
  saveEvent,
  type RunStarted,
  type RunFinished,
  type RunError,
  type TextMessageStart,
  type TextMessageContent,
  type TextMessageEnd,
} from "@/lib/agui";

export const runtime = "nodejs";

type Kind = "start" | "text" | "end" | "error";

interface StartPayload {
  kind: "start";
  sessionId: string;
  profile: string;
  runId: string;
  messageId: string;
  cwd?: string | null;
  label?: string | null;
}

interface TextPayload {
  kind: "text";
  sessionId: string;
  runId: string;
  messageId: string;
  delta: string;
}

interface EndPayload {
  kind: "end";
  sessionId: string;
  runId: string;
  messageId: string;
  exitCode?: number | null;
}

interface ErrorPayload {
  kind: "error";
  sessionId: string;
  runId: string;
  messageId: string;
  message: string;
}

type Body = StartPayload | TextPayload | EndPayload | ErrorPayload;

function threadIdFor(sessionId: string): string {
  return `terminal:${sessionId}`;
}

function ensureThread(threadId: string, title: string): void {
  const db = getDb();
  const existing = db
    .prepare("SELECT id FROM threads WHERE id = ?")
    .get(threadId) as { id: string } | undefined;
  if (!existing) createThread(threadId, title);
}

function validate(body: unknown): Body | { error: string } {
  if (!body || typeof body !== "object") return { error: "body must be an object" };
  const b = body as Record<string, unknown>;
  const kind = b.kind;
  if (kind !== "start" && kind !== "text" && kind !== "end" && kind !== "error") {
    return { error: "kind must be one of start|text|end|error" };
  }
  const sid = typeof b.sessionId === "string" ? b.sessionId : "";
  const rid = typeof b.runId === "string" ? b.runId : "";
  const mid = typeof b.messageId === "string" ? b.messageId : "";
  if (!sid) return { error: "sessionId required" };
  if (!rid) return { error: "runId required" };
  if (!mid) return { error: "messageId required" };

  if (kind === "start") {
    const profile = typeof b.profile === "string" ? b.profile : "";
    if (!profile) return { error: "profile required for start" };
    return {
      kind,
      sessionId: sid,
      profile,
      runId: rid,
      messageId: mid,
      cwd: typeof b.cwd === "string" ? b.cwd : null,
      label: typeof b.label === "string" ? b.label : null,
    };
  }
  if (kind === "text") {
    const delta = typeof b.delta === "string" ? b.delta : "";
    if (!delta) return { error: "delta required for text" };
    return { kind, sessionId: sid, runId: rid, messageId: mid, delta };
  }
  if (kind === "end") {
    return {
      kind,
      sessionId: sid,
      runId: rid,
      messageId: mid,
      exitCode: typeof b.exitCode === "number" ? b.exitCode : null,
    };
  }
  const message = typeof b.message === "string" ? b.message : "unknown error";
  return { kind, sessionId: sid, runId: rid, messageId: mid, message };
}

function emit(threadId: string, evt: ReturnType<typeof createEvent>): void {
  saveEvent(evt);
  hub.publish(threadId, evt);
}

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const body = validate(raw);
  if ("error" in body) {
    return NextResponse.json({ error: body.error }, { status: 400 });
  }
  const threadId = threadIdFor(body.sessionId);

  if (body.kind === "start") {
    ensureThread(threadId, `Terminal · ${body.label ?? body.profile}`);
    createRun(body.runId, threadId, `terminal:${body.profile}`);
    const runStart = createEvent<RunStarted>("RunStarted", threadId, {
      runId: body.runId,
      model: `terminal:${body.profile}`,
    });
    emit(threadId, runStart);
    const msgStart = createEvent<TextMessageStart>("TextMessageStart", threadId, {
      runId: body.runId,
      messageId: body.messageId,
      role: "assistant",
    });
    emit(threadId, msgStart);
    return NextResponse.json({ ok: true, threadId });
  }

  if (body.kind === "text") {
    const evt = createEvent<TextMessageContent>("TextMessageContent", threadId, {
      runId: body.runId,
      messageId: body.messageId,
      delta: body.delta,
    });
    emit(threadId, evt);
    return NextResponse.json({ ok: true });
  }

  if (body.kind === "end") {
    const msgEnd = createEvent<TextMessageEnd>("TextMessageEnd", threadId, {
      runId: body.runId,
      messageId: body.messageId,
    });
    emit(threadId, msgEnd);
    const runEnd = createEvent<RunFinished>("RunFinished", threadId, {
      runId: body.runId,
    });
    emit(threadId, runEnd);
    finishRun(body.runId);
    return NextResponse.json({ ok: true });
  }

  // error
  const msgEnd = createEvent<TextMessageEnd>("TextMessageEnd", threadId, {
    runId: body.runId,
    messageId: body.messageId,
  });
  emit(threadId, msgEnd);
  const runErr = createEvent<RunError>("RunError", threadId, {
    runId: body.runId,
    error: { message: body.message },
  });
  emit(threadId, runErr);
  errorRun(body.runId, body.message);
  return NextResponse.json({ ok: true });
}
