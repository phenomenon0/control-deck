/**
 * Middleware auth matrix — root middleware.ts gates /api/* with DECK_TOKEN.
 *
 * Matrix: DECK_TOKEN set / unset / unset-in-production × URL-token exception
 * list (/api/tools/bridge, /api/serve/*, /api/mcp/tools, /api/tools/catalog)
 * × authed / unauthed requests. Each cell asserts allow (200 from
 * NextResponse.next()) or deny (401 JSON, or 503 for prod-without-token).
 *
 * The middleware reads DECK_TOKEN / TOOL_BRIDGE_TOKEN per request, so tests
 * flip env between cases. IS_PROD is captured at module evaluation, so the
 * production 503 branch gets its own cache-busted module instance imported
 * while NODE_ENV=production.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

const DECK = "deck-secret-test";
const BRIDGE = "bridge-secret-test";

// Save the ambient env; restore after all cells so later files in this
// process see the original values.
const ORIG = {
  DECK_TOKEN: process.env.DECK_TOKEN,
  TOOL_BRIDGE_TOKEN: process.env.TOOL_BRIDGE_TOKEN,
  NODE_ENV: process.env.NODE_ENV,
};

function setEnv(env: { deck?: string; bridge?: string }): void {
  if (env.deck === undefined) delete process.env.DECK_TOKEN;
  else process.env.DECK_TOKEN = env.deck;
  if (env.bridge === undefined) delete process.env.TOOL_BRIDGE_TOKEN;
  else process.env.TOOL_BRIDGE_TOKEN = env.bridge;
}

afterAll(() => {
  for (const [key, value] of Object.entries(ORIG)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function req(
  path: string,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(`http://localhost${path}`, { headers });
}

function post(path: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost${path}`, { method: "POST", headers });
}

const bearer = { Authorization: `Bearer ${DECK}` };
const deckHeader = { "X-Deck-Token": DECK };

/** Allow = middleware passed the request through (NextResponse.next() → 200). */
function expectAllow(res: Response): void {
  expect(res.status).toBe(200);
}

async function expect401(res: Response): Promise<void> {
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ error: "Unauthorized" });
}

describe("DECK_TOKEN set — header credentials", () => {
  test("valid Bearer → allow on any path", () => {
    setEnv({ deck: DECK });
    expectAllow(middleware(req("/api/chat", bearer)));
  });

  test("wrong Bearer → 401", async () => {
    setEnv({ deck: DECK });
    await expect401(middleware(req("/api/chat", { Authorization: `Bearer wrong` })));
  });

  test("valid X-Deck-Token → allow (SSE clients can't set Authorization)", () => {
    setEnv({ deck: DECK });
    expectAllow(middleware(req("/api/agui/events", deckHeader)));
  });

  test("wrong X-Deck-Token → 401", async () => {
    setEnv({ deck: DECK });
    await expect401(middleware(req("/api/agui/events", { "X-Deck-Token": "wrong" })));
  });

  test("no credentials → 401", async () => {
    setEnv({ deck: DECK });
    await expect401(middleware(req("/api/chat")));
  });

  test("URL ?token on a non-exception path does NOT authenticate", async () => {
    setEnv({ deck: DECK });
    await expect401(middleware(req(`/api/chat?token=${DECK}`)));
  });

  test("valid Bearer also passes on exception paths (no URL token needed)", () => {
    setEnv({ deck: DECK });
    expectAllow(middleware(req("/api/mcp/tools", bearer)));
    expectAllow(middleware(req("/api/tools/catalog", bearer)));
  });
});

describe("DECK_TOKEN set — /api/tools/bridge exception (bridge_token param)", () => {
  test("bridge_token=DECK_TOKEN allows when TOOL_BRIDGE_TOKEN unset", () => {
    setEnv({ deck: DECK });
    expectAllow(middleware(req(`/api/tools/bridge?bridge_token=${DECK}`)));
  });

  test("TOOL_BRIDGE_TOKEN set: bridge_token=TOOL_BRIDGE_TOKEN allows", () => {
    setEnv({ deck: DECK, bridge: BRIDGE });
    expectAllow(middleware(req(`/api/tools/bridge?bridge_token=${BRIDGE}`)));
  });

  test("TOOL_BRIDGE_TOKEN set: bridge_token=DECK_TOKEN now 401s (bridge token overrides)", async () => {
    setEnv({ deck: DECK, bridge: BRIDGE });
    await expect401(middleware(req(`/api/tools/bridge?bridge_token=${DECK}`)));
  });

  test("?token= is NOT the bridge param → 401", async () => {
    setEnv({ deck: DECK });
    await expect401(middleware(req(`/api/tools/bridge?token=${DECK}`)));
  });

  test("no param → 401", async () => {
    setEnv({ deck: DECK });
    await expect401(middleware(req("/api/tools/bridge")));
  });
});

describe("DECK_TOKEN set — /api/serve/* exception (token param, proxy paths only)", () => {
  test("/api/serve/<id>?token=DECK_TOKEN allows", () => {
    setEnv({ deck: DECK });
    expectAllow(middleware(req(`/api/serve/abc123?token=${DECK}`)));
  });

  test("wrong token → 401", async () => {
    setEnv({ deck: DECK });
    await expect401(middleware(req("/api/serve/abc123?token=wrong")));
  });

  test("no token → 401", async () => {
    setEnv({ deck: DECK });
    await expect401(middleware(req("/api/serve/abc123")));
  });

  test("bare /api/serve (management route) requires a header credential", async () => {
    setEnv({ deck: DECK });
    await expect401(middleware(req(`/api/serve?token=${DECK}`)));
    expectAllow(middleware(req("/api/serve", bearer)));
  });
});

describe("DECK_TOKEN set — /api/mcp/tools exception (exact path)", () => {
  test("?token=DECK_TOKEN allows", () => {
    setEnv({ deck: DECK });
    expectAllow(middleware(req(`/api/mcp/tools?token=${DECK}`)));
  });

  test("no token → 401", async () => {
    setEnv({ deck: DECK });
    await expect401(middleware(req("/api/mcp/tools")));
  });

  test("subpath is NOT covered by the exception → 401", async () => {
    setEnv({ deck: DECK });
    await expect401(middleware(req(`/api/mcp/tools/invoke?token=${DECK}`)));
  });
});

describe("DECK_TOKEN set — /api/tools/catalog exception (token or bridge_token)", () => {
  test("?token=DECK_TOKEN allows", () => {
    setEnv({ deck: DECK });
    expectAllow(middleware(req(`/api/tools/catalog?token=${DECK}`)));
  });

  test("?bridge_token=DECK_TOKEN allows when TOOL_BRIDGE_TOKEN unset", () => {
    setEnv({ deck: DECK });
    expectAllow(middleware(req(`/api/tools/catalog?bridge_token=${DECK}`)));
  });

  test("?bridge_token=TOOL_BRIDGE_TOKEN allows when set", () => {
    setEnv({ deck: DECK, bridge: BRIDGE });
    expectAllow(middleware(req(`/api/tools/catalog?bridge_token=${BRIDGE}`)));
  });

  test("no token → 401", async () => {
    setEnv({ deck: DECK });
    await expect401(middleware(req("/api/tools/catalog")));
  });
});

describe("DECK_TOKEN unset — dev mode is open", () => {
  test("unauthenticated /api/chat → allow", () => {
    setEnv({});
    expectAllow(middleware(req("/api/chat")));
  });

  test("unauthenticated exception path → allow (short-circuit before URL-token logic)", () => {
    setEnv({});
    expectAllow(middleware(req("/api/tools/bridge")));
  });

  test("even a wrong Bearer passes when no token is configured", () => {
    setEnv({});
    expectAllow(middleware(req("/api/chat", { Authorization: "Bearer wrong" })));
  });
});

describe("DECK_TOKEN unset — production fails closed", () => {
  test("503 Backend misconfigured, served for every path", async () => {
    // IS_PROD is captured at module evaluation: import a cache-busted
    // instance of the middleware with NODE_ENV=production. Variable
    // specifier keeps tsc from resolving the query-suffixed path.
    const prevNodeEnv = process.env.NODE_ENV;
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    try {
      const prodSpecifier = "./middleware.ts?prod-instance";
      const prodModule = (await import(prodSpecifier)) as typeof import("./middleware");
      const res = prodModule.middleware(req("/api/chat"));
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "Backend misconfigured: DECK_TOKEN missing" });
    } finally {
      if (prevNodeEnv === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV;
      else (process.env as Record<string, string | undefined>).NODE_ENV = prevNodeEnv;
    }
  });
});

describe("same-origin gate — side-effect methods, independent of DECK_TOKEN", () => {
  // Why: DECK_TOKEN is empty by default, so the origin check is the only
  // thing between a foreign tab and code/execute, the tool bridge and the
  // approvals writer. It must hold with no token AND ahead of a valid one.
  test("cross-origin POST → 403 with no token configured (dev default)", () => {
    setEnv({});
    expect(middleware(post("/api/code/execute", { origin: "http://evil.example" })).status).toBe(403);
  });

  test("cross-origin POST → 403 even with a valid Bearer (origin precedes auth)", () => {
    setEnv({ deck: DECK });
    expect(middleware(post("/api/chat", { ...bearer, origin: "http://evil.example" })).status).toBe(403);
  });

  test("same-origin POST via a loopback alias → allow", () => {
    setEnv({});
    expectAllow(middleware(post("/api/chat", { origin: "http://127.0.0.1" })));
  });

  test("no Origin (server-to-server) POST → allow", () => {
    setEnv({});
    expectAllow(middleware(post("/api/chat")));
  });

  test("cross-origin GET is not origin-gated (CORS keeps reads unreadable)", () => {
    setEnv({});
    expectAllow(middleware(req("/api/chat", { origin: "http://evil.example" })));
  });
});
