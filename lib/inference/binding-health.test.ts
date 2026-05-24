import { afterEach, describe, expect, it } from "bun:test";

import type { ProviderConfig } from "@/lib/llm/providers";
import {
  __resetForTests,
  probeBindingHealth,
  warnOnceForUnreachableBinding,
  type BindingHealthEnv,
} from "./binding-health";

afterEach(() => {
  __resetForTests();
});

function makeEnv(opts: {
  responses?: Array<{ ok: boolean; status: number } | "throw">;
  now?: () => number;
  warn?: (msg: string) => void;
  ttlMs?: number;
  timeoutMs?: number;
}): Partial<BindingHealthEnv> & { fetchCalls: string[] } {
  const calls: string[] = [];
  const responses = [...(opts.responses ?? [])];
  return {
    fetchCalls: calls,
    now: opts.now ?? (() => 1_000_000),
    ttlMs: opts.ttlMs ?? 30_000,
    timeoutMs: opts.timeoutMs ?? 1_500,
    warn: opts.warn ?? (() => {}),
    fetch: async (url: string) => {
      calls.push(url);
      const next = responses.shift();
      if (!next) throw new Error("no more mock responses queued");
      if (next === "throw") throw new Error("ECONNREFUSED");
      return next;
    },
  };
}

describe("probeBindingHealth", () => {
  it("returns reachable=true without probing for cloud providers", async () => {
    const env = makeEnv({});
    const cfg: ProviderConfig = { provider: "openai", apiKey: "sk-test" };
    const result = await probeBindingHealth(cfg, env);
    expect(result.reachable).toBe(true);
    expect(env.fetchCalls).toEqual([]);
  });

  it("probes ollama at /api/tags and returns reachable on 200", async () => {
    const env = makeEnv({ responses: [{ ok: true, status: 200 }] });
    const cfg: ProviderConfig = {
      provider: "ollama",
      baseURL: "http://127.0.0.1:11434/v1",
    };
    const result = await probeBindingHealth(cfg, env);
    expect(result.reachable).toBe(true);
    expect(env.fetchCalls).toHaveLength(1);
    expect(env.fetchCalls[0]).toBe("http://127.0.0.1:11434/api/tags");
  });

  it("probes llama_server at /v1/models", async () => {
    const env = makeEnv({ responses: [{ ok: true, status: 200 }] });
    const cfg: ProviderConfig = {
      provider: "llama_server",
      baseURL: "http://127.0.0.1:8080/v1",
    };
    const result = await probeBindingHealth(cfg, env);
    expect(result.reachable).toBe(true);
    expect(env.fetchCalls).toHaveLength(1);
    expect(env.fetchCalls[0]).toBe("http://127.0.0.1:8080/v1/models");
  });

  it("marks unreachable when the local probe throws (daemon offline)", async () => {
    const env = makeEnv({ responses: ["throw"] });
    const cfg: ProviderConfig = {
      provider: "llama_server",
      baseURL: "http://127.0.0.1:8080/v1",
    };
    const result = await probeBindingHealth(cfg, env);
    expect(result.reachable).toBe(false);
    expect(result.error).toContain("ECONNREFUSED");
  });

  it("marks unreachable when probe returns non-2xx", async () => {
    const env = makeEnv({ responses: [{ ok: false, status: 503 }] });
    const cfg: ProviderConfig = {
      provider: "ollama",
      baseURL: "http://127.0.0.1:11434/v1",
    };
    const result = await probeBindingHealth(cfg, env);
    expect(result.reachable).toBe(false);
    expect(result.error).toBe("HTTP 503");
  });

  it("caches results for ttlMs and skips the fetch on a fresh hit", async () => {
    let now = 1_000_000;
    const env = makeEnv({
      responses: [{ ok: true, status: 200 }],
      now: () => now,
      ttlMs: 30_000,
    });
    const cfg: ProviderConfig = {
      provider: "ollama",
      baseURL: "http://127.0.0.1:11434/v1",
    };
    await probeBindingHealth(cfg, env);
    now += 5_000; // still within TTL
    await probeBindingHealth(cfg, env);
    expect(env.fetchCalls).toHaveLength(1);
  });

  it("re-probes once the cache TTL elapses", async () => {
    let now = 1_000_000;
    const env = makeEnv({
      responses: [
        { ok: false, status: 503 },
        { ok: true, status: 200 },
      ],
      now: () => now,
      ttlMs: 30_000,
    });
    const cfg: ProviderConfig = {
      provider: "ollama",
      baseURL: "http://127.0.0.1:11434/v1",
    };
    const first = await probeBindingHealth(cfg, env);
    expect(first.reachable).toBe(false);
    now += 30_001;
    const second = await probeBindingHealth(cfg, env);
    expect(second.reachable).toBe(true);
    expect(env.fetchCalls).toHaveLength(2);
  });

  it("returns false for an unknown provider id", async () => {
    const env = makeEnv({});
    const cfg = { provider: "definitely-not-a-provider", baseURL: "http://x" } as unknown as ProviderConfig;
    const result = await probeBindingHealth(cfg, env);
    expect(result.reachable).toBe(false);
    expect(result.error).toContain("unknown provider");
    expect(env.fetchCalls).toEqual([]);
  });
});

describe("warnOnceForUnreachableBinding", () => {
  it("warns the first time and stays quiet for subsequent calls on the same key", () => {
    const messages: string[] = [];
    const env: Partial<BindingHealthEnv> = { warn: (m) => messages.push(m) };
    const cfg: ProviderConfig = {
      provider: "llama_server",
      baseURL: "http://127.0.0.1:8080/v1",
    };
    warnOnceForUnreachableBinding(cfg, { reachable: false, error: "ECONNREFUSED", sampledAt: 0 }, env);
    warnOnceForUnreachableBinding(cfg, { reachable: false, error: "ECONNREFUSED", sampledAt: 100 }, env);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("llama_server");
    expect(messages[0]).toContain("http://127.0.0.1:8080/v1");
    expect(messages[0]).toContain("ECONNREFUSED");
  });

  it("re-warns after a successful probe clears the dedup", async () => {
    const messages: string[] = [];
    const env: BindingHealthEnv = {
      now: () => 1_000_000,
      ttlMs: 30_000,
      timeoutMs: 1_500,
      warn: (m) => messages.push(m),
      fetch: async () => ({ ok: true, status: 200 }),
    };
    const cfg: ProviderConfig = {
      provider: "ollama",
      baseURL: "http://127.0.0.1:11434/v1",
    };
    warnOnceForUnreachableBinding(cfg, { reachable: false, error: "down", sampledAt: 0 }, env);
    expect(messages).toHaveLength(1);

    // A successful probe clears the warn dedup so the next outage gets a
    // fresh warning instead of staying silent forever.
    await probeBindingHealth(cfg, env);
    warnOnceForUnreachableBinding(cfg, { reachable: false, error: "down again", sampledAt: 200 }, env);
    expect(messages).toHaveLength(2);
    expect(messages[1]).toContain("down again");
  });
});
