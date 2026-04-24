import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { buildLoopbackTransport, loadBrowserTransport } from "./transport";

describe("buildLoopbackTransport", () => {
  test("builds localhost transport with no token when no public env is set", () => {
    const transport = buildLoopbackTransport({
      hostname: "127.0.0.1",
      protocol: "http:",
      env: {},
    });

    expect(transport).toEqual({
      httpBase: "http://127.0.0.1:4010",
      wsBase: "ws://127.0.0.1:4010",
      token: "",
    });
  });

  test("respects explicit public terminal service URLs", () => {
    const transport = buildLoopbackTransport({
      hostname: "deck.local",
      protocol: "https:",
      env: {
        NEXT_PUBLIC_TERMINAL_SERVICE_URL: "https://term.example.test",
        NEXT_PUBLIC_TERMINAL_SERVICE_WS_URL: "wss://term.example.test",
      },
    });

    expect(transport).toEqual({
      httpBase: "https://term.example.test",
      wsBase: "wss://term.example.test",
      token: "",
    });
  });
});

describe("loadBrowserTransport", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    mock.restore();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    mock.restore();
  });

  test("prefers the server-provided terminal config when available", async () => {
    const fetchMock = mock(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("/api/terminal/config");
      return new Response(
        JSON.stringify({
          ok: true,
          baseUrl: "http://127.0.0.1:4010",
          wsBaseUrl: "ws://127.0.0.1:4010",
          token: "secret-token",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });

    const transport = await loadBrowserTransport({
      fetchImpl: fetchMock as unknown as typeof fetch,
      hostname: "127.0.0.1",
      protocol: "http:",
      env: {},
    });

    expect(transport).toEqual({
      httpBase: "http://127.0.0.1:4010",
      wsBase: "ws://127.0.0.1:4010",
      token: "secret-token",
    });
  });

  test("falls back to loopback transport if the server config route fails", async () => {
    const fetchMock = mock(async () => {
      throw new Error("boom");
    });

    const transport = await loadBrowserTransport({
      fetchImpl: fetchMock as unknown as typeof fetch,
      hostname: "localhost",
      protocol: "http:",
      env: {},
    });

    expect(transport).toEqual({
      httpBase: "http://localhost:4010",
      wsBase: "ws://localhost:4010",
      token: "",
    });
  });

  test("falls back when the config route returns ok:false", async () => {
    const fetchMock = mock(async () => {
      return new Response(JSON.stringify({ ok: false, error: "missing" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const transport = await loadBrowserTransport({
      fetchImpl: fetchMock as unknown as typeof fetch,
      hostname: "localhost",
      protocol: "https:",
      env: {},
    });

    expect(transport).toEqual({
      httpBase: "https://localhost:4010",
      wsBase: "wss://localhost:4010",
      token: "",
    });
  });
});
