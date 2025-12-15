import { NextResponse } from "next/server";
import {
  getThreads,
  getThread,
  createThread,
  deleteThread,
  getMessages,
  saveMessage,
  updateMessage,
  updateThreadTitle,
  getArtifactsByThread,
  type ArtifactRow,
} from "@/lib/agui/db";

// GET /api/threads - List all threads
// GET /api/threads?id=xxx - Get single thread with messages
export async function GET(req: Request) {
  const url = new URL(req.url);
  const threadId = url.searchParams.get("id");

  if (threadId) {
    const thread = getThread(threadId);
    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }
    const messages = getMessages(threadId);
    const artifacts = getArtifactsByThread(threadId);
    
    // Group artifacts by run_id
    const artifactsByRun = new Map<string, ArtifactRow[]>();
    for (const a of artifacts) {
      if (a.run_id) {
        const list = artifactsByRun.get(a.run_id) || [];
        list.push(a);
        artifactsByRun.set(a.run_id, list);
      }
    }
    
    // Attach artifacts to messages by run_id
    const messagesWithArtifacts = messages.map(m => {
      const msgArtifacts = m.run_id ? (artifactsByRun.get(m.run_id) || []) : [];
      return {
        id: m.id,
        role: m.role,
        content: m.content,
        created_at: m.created_at,
        artifacts: msgArtifacts.map(a => ({
          id: a.id,
          url: a.url,
          name: a.name,
          mimeType: a.mime_type,
        })),
      };
    });
    
    console.log("[Threads API] Loading thread:", threadId, "messages:", messages.length, "artifacts:", artifacts.length);
    
    return NextResponse.json({ thread, messages: messagesWithArtifacts });
  }

  const threads = getThreads();
  return NextResponse.json({ threads });
}

// POST /api/threads - Create thread or save message
export async function POST(req: Request) {
  const body = await req.json();

  // Create new thread
  if (body.action === "create") {
    const id = body.id ?? crypto.randomUUID();
    createThread(id, body.title);
    return NextResponse.json({ id });
  }

  // Save message to thread
  if (body.action === "message") {
    const { threadId, id, role, content, runId } = body;
    if (!threadId || !role || content === undefined) {
      return NextResponse.json(
        { error: "threadId, role, and content required" },
        { status: 400 }
      );
    }

    // Create thread if it doesn't exist
    if (!getThread(threadId)) {
      createThread(threadId);
    }

    const messageId = id ?? crypto.randomUUID();
    console.log("[Threads API] Saving message:", { messageId, threadId, role, runId: runId ?? "null" });
    saveMessage(messageId, threadId, role, content, runId);

    // Auto-generate title from first user message
    const thread = getThread(threadId);
    if (thread && !thread.title && role === "user" && content) {
      const title = content.slice(0, 50) + (content.length > 50 ? "..." : "");
      updateThreadTitle(threadId, title);
    }

    return NextResponse.json({ id: messageId });
  }

  // Update message content
  if (body.action === "update") {
    const { id, content } = body;
    if (!id || content === undefined) {
      return NextResponse.json(
        { error: "id and content required" },
        { status: 400 }
      );
    }
    updateMessage(id, content);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

// DELETE /api/threads?id=xxx - Delete thread
export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const threadId = url.searchParams.get("id");

  if (!threadId) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  deleteThread(threadId);
  return NextResponse.json({ ok: true });
}
