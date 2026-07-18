/**
 * Token-gating tests for the agent-ts HTTP layer.
 *
 * Exercises the `checkToken` helper directly — full-loop tests run via
 * tsx in this package, so we keep the surface small and focused on the
 * 401-path that protects /runs.
 *
 * Run with: `tsx --test src/server/http.test.ts`
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";

import { createHandler, __testHooks } from "./http.js";
import { ApprovalBroker } from "./broker.js";
import { EventBus } from "./event-bus.js";
import type { RunManager } from "./runs.js";
import type { StartRunRequestWire } from "../wire.js";

const { checkToken } = __testHooks;

function fakeReq(headers: Record<string, string> = {}): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

const URL_NO_TOKEN = new URL("http://internal/runs");
const URL_WITH_TOKEN = (token: string) => new URL(`http://internal/runs?token=${token}`);

test("checkToken: passes when no token configured", () => {
  assert.equal(checkToken({ authToken: undefined } as never, fakeReq(), URL_NO_TOKEN), true);
});

test("checkToken: rejects when token configured but request unauthenticated", () => {
  assert.equal(checkToken({ authToken: "secret" } as never, fakeReq(), URL_NO_TOKEN), false);
});

test("checkToken: accepts Authorization: Bearer <token>", () => {
  const req = fakeReq({ authorization: "Bearer secret" });
  assert.equal(checkToken({ authToken: "secret" } as never, req, URL_NO_TOKEN), true);
});

test("checkToken: accepts X-Agent-TS-Token header", () => {
  const req = fakeReq({ "x-agent-ts-token": "secret" });
  assert.equal(checkToken({ authToken: "secret" } as never, req, URL_NO_TOKEN), true);
});

test("checkToken: accepts ?token query (for SSE EventSource)", () => {
  assert.equal(
    checkToken({ authToken: "secret" } as never, fakeReq(), URL_WITH_TOKEN("secret")),
    true,
  );
});

test("checkToken: rejects mismatched bearer", () => {
  const req = fakeReq({ authorization: "Bearer wrong" });
  assert.equal(checkToken({ authToken: "secret" } as never, req, URL_NO_TOKEN), false);
});

test("checkToken: rejects mismatched query token", () => {
  assert.equal(
    checkToken({ authToken: "secret" } as never, fakeReq(), URL_WITH_TOKEN("wrong")),
    false,
  );
});

/* ------------------------------------------------------------------------ */
/* POST /runs — `llm` field validation (deck-resolved complete config)       */
/* ------------------------------------------------------------------------ */

/**
 * Drive the real handler over a loopback server. The RunManager is stubbed
 * so validation failures can be asserted as "start was never called".
 */
async function withHandler(
  fn: (base: string, started: StartRunRequestWire[]) => Promise<void>,
): Promise<void> {
  const started: StartRunRequestWire[] = [];
  const runs = {
    start: (body: StartRunRequestWire) => {
      started.push(body);
      return { runId: "run-1", threadId: "thread-1" };
    },
  } as unknown as RunManager;
  const handler = createHandler({
    broker: new ApprovalBroker(),
    bus: new EventBus(),
    runs,
    llm: { base_url: "http://127.0.0.1:1/v1", model: "m", healthCheck: async () => "ok" },
  });
  const server: Server = createServer((req, res) => {
    handler(req, res).catch(() => {
      if (!res.writableEnded) {
        res.writeHead(500);
        res.end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("server failed to bind");
  try {
    await fn(`http://127.0.0.1:${addr.port}`, started);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function postRuns(
  base: string,
  body: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${base}/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

test("start run: malformed llm (missing base_url/model) is a 400, run not started", async () => {
  await withHandler(async (base, started) => {
    const res = await postRuns(base, { query: "hi", llm: { provider: "ollama" } });
    assert.equal(res.status, 400);
    assert.match(String(res.json.error), /'llm'/);
    assert.equal(started.length, 0, "run must not start on a malformed llm");
  });
});

test("start run: non-object llm is a 400", async () => {
  await withHandler(async (base, started) => {
    const res = await postRuns(base, { query: "hi", llm: "ollama" });
    assert.equal(res.status, 400);
    assert.equal(started.length, 0);
  });
});

test("start run: complete deck llm config passes validation untouched", async () => {
  await withHandler(async (base, started) => {
    const llm = {
      provider: "ollama",
      model: "qwen3:8b",
      base_url: "http://localhost:11434/v1",
      api_key: null,
    };
    const res = await postRuns(base, { query: "hi", llm });
    assert.equal(res.status, 201);
    assert.equal(started.length, 1);
    assert.deepEqual(started[0].llm, llm, "config forwarded to the run exactly as sent");
  });
});
