import { bindSessionThread, getSessionThreads } from "@/lib/voice/agent-bridge/session-store";
import { jsonError } from "@/lib/http/json";

export async function GET() {
  return Response.json(getSessionThreads());
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body");
  }

  if (!body || typeof body !== "object") {
    return jsonError("JSON object body is required");
  }

  const { alias, threadId } = body as { alias?: unknown; threadId?: unknown };
  if (typeof alias !== "string" || !alias.trim()) {
    return jsonError("alias is required");
  }
  if (typeof threadId !== "string" || !threadId.trim()) {
    return jsonError("threadId is required");
  }

  try {
    bindSessionThread(alias, threadId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unable to bind session";
    return jsonError(message);
  }

  return Response.json(getSessionThreads());
}
