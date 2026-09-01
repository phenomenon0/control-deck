/**
 * POST /api/agentgo/runs — start an agent-ts run for the AgentGo pane ON THE
 * SPINE: the same assemble → resolve → build → start path /api/chat takes,
 * so the pane gets the deck-assembled system prompt, the resolved model
 * route and the tool bridge instead of agent-ts's standalone defaults
 * (local prompt + bootstrap files, env-resolved model, no bridge tools).
 *
 * Body:  { query: string, mode?: "PLAN"|"BUILD"|"AUTO", max_steps?: number }
 * Reply: { run_id } — the pane then streams /runs/:id/events from agent-ts
 * directly, as it always has. The run is deliberately NOT written to the
 * deck ledger: nothing on this path consumes the stream, so a ledger row
 * would sit at "running" forever.
 */

import { NextRequest } from "next/server";
import { jsonError } from "@/lib/http/json";
import { generateId } from "@/lib/agui/events";
import { augmentForModel } from "@/lib/llm/systemPrompt";
import { buildToolBridgeUrl, buildMcpToolsUrl } from "@/lib/tools/bridge-url";
import { assembleSystemPrompt } from "@/app/api/chat/_lib/prompt";
import { resolveChatModel } from "@/app/api/chat/_lib/model-route";
import { buildAgentMessages, buildStartRunRequest, startAgentRun } from "@/app/api/chat/_lib/agent-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODES = new Set(["PLAN", "BUILD", "AUTO"]);

export async function POST(req: NextRequest): Promise<Response> {
  let body: { query?: unknown; mode?: unknown; max_steps?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonError("body must be JSON: { query, mode?, max_steps? }");
  }
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) return jsonError("query must be a non-empty string");
  const mode = typeof body.mode === "string" && MODES.has(body.mode) ? body.mode : undefined;
  const maxSteps =
    typeof body.max_steps === "number" && Number.isInteger(body.max_steps) && body.max_steps > 0
      ? body.max_steps
      : undefined;

  const messages = [{ role: "user" as const, content: query }];
  const systemPrompt = assembleSystemPrompt({ messages });
  const { route, selectedModel } = await resolveChatModel({ preset: "balanced", messages });
  const threadId = generateId();
  const runId = generateId();

  const agentRequest = {
    ...buildStartRunRequest({
      messages: buildAgentMessages(messages),
      threadId,
      runId,
      assembledSystemPrompt: augmentForModel(systemPrompt, selectedModel).trim(),
      route,
      selectedModel,
      toolBridgeUrl: buildToolBridgeUrl(req),
      mcpUrl: buildMcpToolsUrl(req),
    }),
    ...(mode ? { mode } : {}),
    ...(maxSteps ? { max_steps: maxSteps } : {}),
  };

  try {
    const run_id = await startAgentRun(agentRequest, { threadId, runId });
    return Response.json({ run_id });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 502);
  }
}
