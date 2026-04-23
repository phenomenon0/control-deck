import { NextResponse } from "next/server";
import { generateText } from "ai";
import { createProviderClient, getProviderConfig, getDefaultModel } from "@/lib/llm";
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

/**
 * Generate a concise chat title using the fast slot (falls back to primary)
 */
async function generateTitle(userMessage: string): Promise<string> {
  try {
    const slots = getProviderConfig();
    const slot = slots.fast ?? slots.primary;
    const client = createProviderClient(slot);
    const model = slot.model ?? getDefaultModel(slots.fast ? "fast" : "primary") ?? "qwen2.5:1.5b";

    const { text } = await generateText({
      model: client(model) as Parameters<typeof generateText>[0]["model"],
      prompt: `Generate a very short title (2-5 words) for a chat that starts with this message. Return ONLY the title, nothing else. No quotes, no explanation.\n\nMessage: "${userMessage.slice(0, 200)}"`,
      temperature: 0.3,
      maxOutputTokens: 20,
    });

    let title = text.trim();
    title = title.replace(/^["']|["']$/g, ""); // Remove quotes
    title = title.replace(/^Title:\s*/i, "");  // Remove "Title:" prefix
    title = title.split("\n")[0];              // Take first line only
    title = title.slice(0, 50);               // Max 50 chars

    return title || userMessage.slice(0, 30) + "...";
  } catch (error) {
    console.error("[Threads] Title generation failed:", error);
    // Fallback to simple truncation
    return userMessage.slice(0, 30) + (userMessage.length > 30 ? "..." : "");
  }
}

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
    
    // Attach artifacts to messages by run_id and parse metadata
    const messagesWithArtifacts = messages.map(m => {
      const runArtifacts = m.run_id ? (artifactsByRun.get(m.run_id) || []) : [];
      // Parse metadata JSON if present
      let metadata = null;
      if (m.metadata) {
        try {
          metadata = JSON.parse(m.metadata);
        } catch {
          // Ignore parse errors
        }
      }
      // For user messages, reconstruct upload artifacts from metadata
      const uploadArtifacts = (m.role === "user" && metadata?.uploads)
        ? (metadata.uploads as Array<{ id: string; url: string; name: string; mimeType: string }>)
        : [];
      // For assistant messages, use run-linked artifacts from the DB
      const messageArtifacts = runArtifacts.length > 0
        ? runArtifacts.map(a => ({ id: a.id, url: a.url, name: a.name, mimeType: a.mime_type }))
        : uploadArtifacts;
      return {
        id: m.id,
        role: m.role,
        content: m.content,
        created_at: m.created_at,
        metadata,  // Include tool_calls, tool_name for proper conversation reconstruction
        artifacts: messageArtifacts,
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
    const { threadId, id, role, content, runId, metadata } = body;
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
    console.log("[Threads API] Saving message:", { messageId, threadId, role, runId: runId ?? "null", hasMetadata: !!metadata });
    saveMessage({
      id: messageId,
      threadId,
      role,
      content,
      runId,
      metadata,
    });

    // Auto-generate title from first user message using LLM
    const thread = getThread(threadId);
    if (thread && !thread.title && role === "user" && content) {
      // Generate title asynchronously (don't block response)
      generateTitle(content).then((title) => {
        updateThreadTitle(threadId, title);
        console.log("[Threads] Generated title:", title);
      });
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

  // Generate/regenerate title for a thread
  if (body.action === "generate-title") {
    const { threadId } = body;
    if (!threadId) {
      return NextResponse.json({ error: "threadId required" }, { status: 400 });
    }
    
    const messages = getMessages(threadId);
    const firstUserMessage = messages.find(m => m.role === "user");
    
    if (!firstUserMessage) {
      return NextResponse.json({ error: "No user message found" }, { status: 400 });
    }
    
    const title = await generateTitle(firstUserMessage.content);
    updateThreadTitle(threadId, title);
    
    return NextResponse.json({ title });
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
