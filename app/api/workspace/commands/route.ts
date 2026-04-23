import { NextRequest } from "next/server";
import { subscribeCommands, type WorkspaceCommand } from "@/lib/workspace/command-relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/workspace/commands
 *
 * Server-Sent Events stream of workspace commands. Any client that
 * mounts a WorkspaceShell subscribes here; when the agent (via
 * /api/tools/bridge) publishes a workspace_* command, every
 * connected client receives it and executes against its local
 * Dockview API.
 */
export async function GET(_req: NextRequest): Promise<Response> {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      // Kickoff comment so proxies flush headers immediately.
      controller.enqueue(encoder.encode(": ready\n\n"));

      const unsubscribe = subscribeCommands((cmd: WorkspaceCommand) => {
        try {
          const data = `event: workspace-command\ndata: ${JSON.stringify(cmd)}\n\n`;
          controller.enqueue(encoder.encode(data));
        } catch {
          // Controller closed (client disconnect); let the cleanup below run.
        }
      });

      // Periodic heartbeat so idle connections don't get culled by
      // intermediaries.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          clearInterval(heartbeat);
          unsubscribe();
        }
      }, 25_000);

      // Defer cleanup to when the stream is canceled / closed.
      const originalCancel = controller.close.bind(controller);
      controller.close = () => {
        clearInterval(heartbeat);
        unsubscribe();
        originalCancel();
      };
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
