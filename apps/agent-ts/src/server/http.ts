/**
 * Node `http` router for the Agent-GO wire contract.
 *
 * No framework. No middleware system. Match URL + method → handler. Each
 * handler reads/writes JSON or streams SSE. Mirrors `cmd/agentgo-server/main.go`
 * routes 1:1 so existing consumers don't change.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ApprovalBroker } from "./broker.js";
import type { EventBus } from "./event-bus.js";
import type { RunManager } from "./runs.js";
import type {
  AGUIEvent,
  HealthResponseWire,
  StartRunRequestWire,
  StartRunResponseWire,
} from "../wire.js";
import { nowRFC3339 } from "../wire.js";

export interface HttpDeps {
  broker: ApprovalBroker;
  bus: EventBus;
  runs: RunManager;
  llm: {
    base_url: string;
    model: string;
    healthCheck: () => Promise<string>;
  };
  /**
   * Required token for non-/health routes. When unset, dev fall-through with
   * a warning at startup. In production the entrypoint should fail closed.
   */
  authToken?: string;
}

/**
 * Token check for non-/health routes. Mirrors DECK_TOKEN semantics:
 *   - no token configured → permit (dev convenience).
 *   - Authorization: Bearer <token> → permit.
 *   - X-Agent-TS-Token: <token> → permit (for clients that can't set Authorization).
 *   - ?token=<token> query param → permit (for SSE EventSource which can't set headers).
 *   - anything else → 401.
 */
function checkToken(deps: HttpDeps, req: IncomingMessage, url: URL): boolean {
  if (!deps.authToken) return true;
  const auth = (req.headers["authorization"] ?? "") as string;
  if (auth === `Bearer ${deps.authToken}`) return true;
  const headerToken = req.headers["x-agent-ts-token"];
  if (typeof headerToken === "string" && headerToken === deps.authToken) return true;
  if (url.searchParams.get("token") === deps.authToken) return true;
  return false;
}

export function createHandler(deps: HttpDeps) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    setCors(res);
    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", "http://internal");
    const path = url.pathname;

    try {
      // /health is unauthenticated — the launcher polls it before the token
      // is necessarily handed to the caller.
      if (path === "/health") return handleHealth(deps, res);

      if (!checkToken(deps, req, url)) {
        writeJson(res, 401, { error: "unauthorized" });
        return;
      }

      if (path === "/runs" && req.method === "GET") return handleListRuns(deps, url, res);
      if (path === "/runs" && req.method === "POST") return await handleStartRun(deps, req, res);

      const match = path.match(/^\/runs\/([^/]+)(\/[^/]+)?$/);
      if (match) {
        const runId = decodeURIComponent(match[1]);
        const sub = match[2];
        if (!sub) return handleGetRun(deps, runId, res);
        if (sub === "/events") return handleRunEvents(deps, runId, url, req, res);
        if (sub === "/status") return handleRunStatus(deps, runId, res);
        if (sub === "/pause" && req.method === "POST") return handlePause(deps, runId, res);
        if (sub === "/resume" && req.method === "POST") return handleResume(deps, runId, res);
        if (sub === "/cancel" && req.method === "POST") return handleCancel(deps, runId, res);
        if (sub === "/approve" && req.method === "POST")
          return await handleApprove(deps, runId, req, res);
        if (sub === "/reject" && req.method === "POST")
          return await handleReject(deps, runId, req, res);
      }

      writeJson(res, 404, { error: "not found" });
    } catch (err) {
      console.error("[agent-ts] handler error:", err);
      if (!res.writableEnded) {
        writeJson(res, 500, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  };
}

export const __testHooks = { checkToken };

function setCors(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function writeJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJsonBody<T = unknown>(req: IncomingMessage): Promise<T | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return null;
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

async function handleHealth(deps: HttpDeps, res: ServerResponse) {
  const status = await deps.llm.healthCheck().catch((err) => `error: ${err}`);
  const body: HealthResponseWire = {
    status: "ok",
    time: nowRFC3339(),
    llm: {
      base_url: deps.llm.base_url,
      model: deps.llm.model,
      status,
    },
    broker: {
      pending_requests: deps.broker.stats().pending_requests,
      active_runs: deps.runs.size(),
    },
  };
  writeJson(res, 200, body);
}

function handleListRuns(deps: HttpDeps, url: URL, res: ServerResponse) {
  const status = url.searchParams.get("status") ?? undefined;
  const list = deps.bus.list(status).map((r) => ({ run_id: r.runId, status: r.status }));
  writeJson(res, 200, { runs: list });
}

async function handleStartRun(deps: HttpDeps, req: IncomingMessage, res: ServerResponse) {
  const body = await readJsonBody<StartRunRequestWire>(req);
  if (!body) {
    writeJson(res, 400, { error: "invalid request body" });
    return;
  }
  if (!body.messages?.length && !body.query) {
    writeJson(res, 400, { error: "either 'query' or 'messages' is required" });
    return;
  }
  const { runId } = deps.runs.start(body);
  const resp: StartRunResponseWire = { run_id: runId };
  writeJson(res, 201, resp);
}

function handleGetRun(deps: HttpDeps, runId: string, res: ServerResponse) {
  const status = deps.bus.getStatus(runId);
  if (!status) {
    writeJson(res, 404, { error: "run not found" });
    return;
  }
  const events = deps.bus.query(runId, 0, 1000);
  const pending = deps.broker.pendingForRun(runId);
  writeJson(res, 200, {
    run_id: runId,
    status,
    event_count: events.length,
    pending_approvals: pending.length,
  });
}

function handleRunStatus(deps: HttpDeps, runId: string, res: ServerResponse) {
  const handle = deps.runs.get(runId);
  const status = deps.bus.getStatus(runId) ?? "unknown";
  const pending = deps.broker.pendingForRun(runId);
  writeJson(res, 200, {
    run_id: runId,
    status,
    started_at: handle?.startedAt,
    pending_approvals: pending.map((p) => ({
      request_id: p.requestId,
      tool_name: p.toolName,
      description: p.description,
      risk_level: p.riskLevel,
    })),
  });
}

function handleRunEvents(
  deps: HttpDeps,
  runId: string,
  url: URL,
  req: IncomingMessage,
  res: ServerResponse,
) {
  const fromSeq = parseInt(
    url.searchParams.get("after_seq") ?? url.searchParams.get("from_seq") ?? "0",
    10,
  );
  const accept = (req.headers["accept"] ?? "").toString();
  const isPoll = url.searchParams.get("mode") === "poll" || accept === "application/json";

  if (!deps.bus.has(runId)) {
    writeJson(res, 404, { error: "run not found" });
    return;
  }

  if (isPoll) {
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100", 10) || 100, 1000);
    const events = deps.bus.query(runId, fromSeq, limit);
    const lastSeq = events.length > 0 ? (events[events.length - 1]?.seq ?? 0) : 0;
    writeJson(res, 200, {
      run_id: runId,
      status: deps.bus.getStatus(runId),
      events,
      last_seq: lastSeq,
      has_more: events.length === limit,
    });
    return;
  }

  // SSE mode
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const writeEvent = (event: AGUIEvent) => {
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const finish = () => {
    res.write(`event: done\ndata: ${JSON.stringify({ run_id: runId })}\n\n`);
    res.end();
  };

  const unsubscribe = deps.bus.subscribe(runId, fromSeq, writeEvent, finish);
  req.on("close", () => unsubscribe());
}

function handlePause(deps: HttpDeps, runId: string, res: ServerResponse) {
  if (!deps.runs.pause(runId)) {
    writeJson(res, 404, { error: "run not found" });
    return;
  }
  deps.bus.setStatus(runId, "paused_requested");
  writeJson(res, 200, {
    run_id: runId,
    status: "paused_requested",
    message: "Run will pause at next step boundary",
  });
}

function handleResume(deps: HttpDeps, runId: string, res: ServerResponse) {
  if (!deps.runs.resume(runId)) {
    writeJson(res, 404, { error: "run not found" });
    return;
  }
  deps.bus.setStatus(runId, "running");
  writeJson(res, 200, {
    run_id: runId,
    status: "queued",
    message: "Run queued for resumption",
  });
}

function handleCancel(deps: HttpDeps, runId: string, res: ServerResponse) {
  if (!deps.runs.cancel(runId)) {
    writeJson(res, 404, { error: "run not found" });
    return;
  }
  writeJson(res, 200, {
    run_id: runId,
    status: "cancelling",
    message: "Run will abort at next step boundary",
  });
}

async function handleApprove(
  deps: HttpDeps,
  runId: string,
  req: IncomingMessage,
  res: ServerResponse,
) {
  const body = (await readJsonBody<{ request_id?: string }>(req)) ?? {};
  let requestId = body.request_id;
  if (!requestId) {
    const pending = deps.broker.pendingForRun(runId);
    if (pending.length === 0) {
      writeJson(res, 404, { error: "no pending approval requests" });
      return;
    }
    requestId = pending[0].requestId;
  }
  if (!deps.broker.approve(requestId)) {
    writeJson(res, 404, { error: "approval not found" });
    return;
  }
  writeJson(res, 200, { approved: true, request_id: requestId });
}

async function handleReject(
  deps: HttpDeps,
  runId: string,
  req: IncomingMessage,
  res: ServerResponse,
) {
  const body = (await readJsonBody<{ request_id?: string; reason?: string }>(req)) ?? {};
  let requestId = body.request_id;
  if (!requestId) {
    const pending = deps.broker.pendingForRun(runId);
    if (pending.length === 0) {
      writeJson(res, 404, { error: "no pending approval requests" });
      return;
    }
    requestId = pending[0].requestId;
  }
  if (!deps.broker.reject(requestId, body.reason)) {
    writeJson(res, 404, { error: "approval not found" });
    return;
  }
  writeJson(res, 200, { rejected: true, request_id: requestId });
}
