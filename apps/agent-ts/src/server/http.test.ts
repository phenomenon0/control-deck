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
import type { IncomingMessage } from "node:http";

import { __testHooks } from "./http.js";

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
