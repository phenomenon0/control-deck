/**
 * Tests for the mem0 adapter. Fetch is always injected — the suite never
 * touches the real mem0 API. Each test asserts the adapter sends the right
 * shape on the wire and normalizes the response correctly.
 */

import { describe, expect, test } from "bun:test";

import { createMem0Provider } from "./mem0";

interface CapturedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function makeFetch(
  responder: (call: CapturedCall) => { status?: number; body?: unknown },
): { fetchFn: typeof fetch; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(init?.headers ?? {})) {
      headers[k] = String(v);
    }
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const call: CapturedCall = {
      url,
      method: init?.method ?? "GET",
      headers,
      body,
    };
    calls.push(call);
    const { status = 200, body: respBody = {} } = responder(call);
    return new Response(JSON.stringify(respBody), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

describe("createMem0Provider", () => {
  test("returns null when no api key is available", () => {
    const provider = createMem0Provider({ apiKey: "" });
    expect(provider).toBeNull();
  });

  test("uses default base url when none provided", async () => {
    const { fetchFn, calls } = makeFetch(() => ({ body: { id: "m1" } }));
    const provider = createMem0Provider({ apiKey: "sk-test", fetchFn });
    expect(provider).not.toBeNull();
    await provider!.add({ content: "a note", userId: "u1" });
    expect(calls[0].url).toBe("https://api.mem0.ai/v1/memories");
  });

  test("normalizes trailing slashes on baseUrl", async () => {
    const { fetchFn, calls } = makeFetch(() => ({ body: { id: "m1" } }));
    const provider = createMem0Provider({
      apiKey: "sk-test",
      baseUrl: "http://localhost:8000///",
      fetchFn,
    });
    await provider!.add({ content: "x", userId: "u1" });
    expect(calls[0].url).toBe("http://localhost:8000/v1/memories");
  });

  test("add sends Token auth + chat-style messages + agent_id", async () => {
    const { fetchFn, calls } = makeFetch(() => ({ body: { id: "mem-123" } }));
    const provider = createMem0Provider({ apiKey: "sk-real", fetchFn });
    const result = await provider!.add({
      content: "user prefers dark mode",
      userId: "deck-alice",
      metadata: { target: "user" },
    });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.method).toBe("POST");
    expect(call.headers.Authorization).toBe("Token sk-real");
    expect(call.headers["Content-Type"]).toBe("application/json");
    expect(call.body).toEqual({
      messages: [{ role: "user", content: "user prefers dark mode" }],
      user_id: "deck-alice",
      agent_id: "control-deck",
      metadata: { target: "user" },
    });
    expect(result.id).toBe("mem-123");
  });

  test("add extracts id from results[] when top-level id missing", async () => {
    const { fetchFn } = makeFetch(() => ({
      body: { results: [{ id: "mem-from-results" }] },
    }));
    const provider = createMem0Provider({ apiKey: "sk", fetchFn });
    const result = await provider!.add({ content: "x", userId: "u1" });
    expect(result.id).toBe("mem-from-results");
  });

  test("search sends query + limit + filters and maps results", async () => {
    const { fetchFn, calls } = makeFetch(() => ({
      body: [
        { id: "h1", memory: "first hit", score: 0.91, metadata: { target: "memory" } },
        { id: "h2", text: "second hit", score: 0.74 },
      ],
    }));
    const provider = createMem0Provider({ apiKey: "sk", fetchFn });
    const hits = await provider!.search({
      query: "dark mode",
      userId: "u1",
      k: 5,
      metadata: { target: "user" },
    });
    expect(calls[0].url).toBe("https://api.mem0.ai/v1/memories/search");
    expect(calls[0].body).toEqual({
      query: "dark mode",
      user_id: "u1",
      agent_id: "control-deck",
      limit: 5,
      filters: { target: "user" },
    });
    expect(hits).toHaveLength(2);
    expect(hits[0]).toEqual({
      id: "h1",
      content: "first hit",
      score: 0.91,
      metadata: { target: "memory" },
    });
    expect(hits[1].content).toBe("second hit");
    expect(hits[1].metadata).toBeUndefined();
  });

  test("search handles wrapped {results:[]} response shape", async () => {
    const { fetchFn } = makeFetch(() => ({
      body: { results: [{ id: "h1", memory: "wrapped" }] },
    }));
    const provider = createMem0Provider({ apiKey: "sk", fetchFn });
    const hits = await provider!.search({ query: "q", userId: "u1" });
    expect(hits).toHaveLength(1);
    expect(hits[0].id).toBe("h1");
    expect(hits[0].content).toBe("wrapped");
  });

  test("update sends PUT with text + metadata to the id route", async () => {
    const { fetchFn, calls } = makeFetch(() => ({ status: 204 }));
    const provider = createMem0Provider({ apiKey: "sk", fetchFn });
    await provider!.update({ id: "mem-7", content: "fresher", metadata: { revised: "true" } });
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].url).toBe("https://api.mem0.ai/v1/memories/mem-7");
    expect(calls[0].body).toEqual({ text: "fresher", metadata: { revised: "true" } });
  });

  test("update url-encodes the id", async () => {
    const { fetchFn, calls } = makeFetch(() => ({ status: 204 }));
    const provider = createMem0Provider({ apiKey: "sk", fetchFn });
    await provider!.update({ id: "a/b c", content: "x" });
    expect(calls[0].url).toBe("https://api.mem0.ai/v1/memories/a%2Fb%20c");
  });

  test("delete sends DELETE to the id route", async () => {
    const { fetchFn, calls } = makeFetch(() => ({ status: 204 }));
    const provider = createMem0Provider({ apiKey: "sk", fetchFn });
    await provider!.delete({ id: "mem-x" });
    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].url).toBe("https://api.mem0.ai/v1/memories/mem-x");
  });

  test("non-2xx responses throw with status + body", async () => {
    const { fetchFn } = makeFetch(() => ({ status: 401, body: { detail: "bad key" } }));
    const provider = createMem0Provider({ apiKey: "sk", fetchFn });
    await expect(provider!.add({ content: "x", userId: "u1" })).rejects.toThrow(/401/);
  });

  test("update without id throws before hitting the wire", async () => {
    const { fetchFn, calls } = makeFetch(() => ({ body: {} }));
    const provider = createMem0Provider({ apiKey: "sk", fetchFn });
    await expect(provider!.update({ id: "" })).rejects.toThrow(/requires id/);
    expect(calls).toHaveLength(0);
  });
});
