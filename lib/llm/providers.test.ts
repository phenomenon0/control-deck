import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  clearProviderConfigCache,
  getDefaultModel,
  getProviderConfig,
  getProviderInfo,
  getProviderType,
  getRuntimeProvider,
  PROVIDERS,
  requiresApiKey,
  setRuntimeProvider,
} from "./providers";

// Save/restore env vars that influence provider detection.

const ENV_KEYS = [
  "LLM_PROVIDER", "LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL",
  "LLM_FAST_PROVIDER", "LLM_FAST_API_KEY", "LLM_FAST_BASE_URL", "LLM_FAST_MODEL",
  "LLM_VISION_PROVIDER", "LLM_VISION_API_KEY", "LLM_VISION_BASE_URL", "LLM_VISION_MODEL",
  "LLM_EMBEDDING_PROVIDER", "LLM_EMBEDDING_API_KEY", "LLM_EMBEDDING_BASE_URL", "LLM_EMBEDDING_MODEL",
] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  setRuntimeProvider(null);
  clearProviderConfigCache();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  setRuntimeProvider(null);
  clearProviderConfigCache();
});

// ── PROVIDERS catalog invariants ──────────────────────────────────

describe("PROVIDERS catalog", () => {
  test("every registered provider is internally consistent (id matches key, has name, has defaultModels array)", () => {
    for (const [key, info] of Object.entries(PROVIDERS)) {
      expect(info.id).toBe(key as typeof info.id);
      expect(info.name.length).toBeGreaterThan(0);
      expect(Array.isArray(info.defaultModels)).toBe(true);
      // Local/self-hosted providers (llama.cpp, vLLM, LM Studio, custom)
      // intentionally ship empty default model lists — the user brings
      // their own. Only assert non-empty where we expect suggestions.
    }
  });

  test("cloud providers require API keys; local ones don't", () => {
    const cloudProviders = ["openai", "anthropic", "google", "deepseek", "openrouter", "huggingface"] as const;
    const localProviders = ["ollama", "llama_server", "vllm", "lmstudio"] as const;
    for (const p of cloudProviders) expect(PROVIDERS[p].requiresApiKey).toBe(true);
    for (const p of localProviders) expect(PROVIDERS[p].requiresApiKey).toBe(false);
  });
});

// ── getProviderConfig ─────────────────────────────────────────────

describe("getProviderConfig", () => {
  test("no env → ollama primary, no other slots", () => {
    const slots = getProviderConfig();
    expect(slots.primary.provider).toBe("ollama");
    expect(slots.primary.baseURL).toBe("http://localhost:11434/v1");
    expect(slots.fast).toBeUndefined();
    expect(slots.vision).toBeUndefined();
    expect(slots.embedding).toBeUndefined();
  });

  test("LLM_PROVIDER selects primary", () => {
    process.env.LLM_PROVIDER = "anthropic";
    process.env.LLM_API_KEY = "sk-ant-test";
    process.env.LLM_MODEL = "claude-3-5-sonnet-20241022";
    const { primary } = getProviderConfig();
    expect(primary.provider).toBe("anthropic");
    expect(primary.apiKey).toBe("sk-ant-test");
    expect(primary.model).toBe("claude-3-5-sonnet-20241022");
  });

  test("LLM_FAST_PROVIDER populates the fast slot", () => {
    process.env.LLM_FAST_PROVIDER = "ollama";
    process.env.LLM_FAST_MODEL = "qwen2.5:0.5b";
    const { fast } = getProviderConfig();
    expect(fast).toBeDefined();
    expect(fast!.provider).toBe("ollama");
    expect(fast!.model).toBe("qwen2.5:0.5b");
  });
});

// ── runtime provider override ────────────────────────────────────

describe("setRuntimeProvider / getRuntimeProvider", () => {
  test("runtime override replaces primary without affecting other slots", () => {
    process.env.LLM_FAST_PROVIDER = "ollama";
    setRuntimeProvider({ provider: "anthropic", apiKey: "sk-rt" });
    const slots = getProviderConfig();
    expect(slots.primary).toEqual({ provider: "anthropic", apiKey: "sk-rt" });
    // Fast slot still read from env
    expect(slots.fast?.provider).toBe("ollama");
  });

  test("null clears the override", () => {
    setRuntimeProvider({ provider: "openai", apiKey: "k" });
    expect(getRuntimeProvider()?.provider).toBe("openai");
    setRuntimeProvider(null);
    expect(getRuntimeProvider()).toBeNull();
  });
});

// ── cache behavior ────────────────────────────────────────────────

describe("caching", () => {
  test("repeated calls return the same ProviderSlots reference", () => {
    const a = getProviderConfig();
    const b = getProviderConfig();
    expect(b).toBe(a);
  });

  test("clearProviderConfigCache forces a fresh read", () => {
    process.env.LLM_PROVIDER = "ollama";
    const first = getProviderConfig();
    process.env.LLM_PROVIDER = "openai";
    process.env.LLM_API_KEY = "x";
    expect(getProviderConfig()).toBe(first); // still cached
    clearProviderConfigCache();
    expect(getProviderConfig().primary.provider).toBe("openai");
  });
});

// ── getDefaultModel / getProviderType / getProviderInfo ──────────

describe("slot accessors", () => {
  test("getDefaultModel returns primary by default", () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.LLM_MODEL = "gpt-4o-mini";
    expect(getDefaultModel()).toBe("gpt-4o-mini");
  });

  test("getDefaultModel falls back to the ollama catalog default for unset slots", () => {
    // Current behavior (intentional): when the slot has no config, the
    // function returns PROVIDERS.ollama.defaultModels[0] so callers
    // always get *something* to use locally. This test documents that
    // fallback — if the policy changes, update here.
    expect(getDefaultModel("fast")).toBe(PROVIDERS.ollama.defaultModels[0]);
  });

  test("getProviderType falls back to 'ollama' for undefined slots", () => {
    expect(getProviderType("fast")).toBe("ollama");
  });

  test("getProviderType reads configured primary", () => {
    process.env.LLM_PROVIDER = "anthropic";
    process.env.LLM_API_KEY = "k";
    expect(getProviderType()).toBe("anthropic");
  });

  test("getProviderInfo returns the catalog entry", () => {
    const info = getProviderInfo("anthropic");
    expect(info.name).toBe("Anthropic");
    expect(info.requiresApiKey).toBe(true);
  });

  test("requiresApiKey matches PROVIDERS catalog", () => {
    expect(requiresApiKey("openai")).toBe(true);
    expect(requiresApiKey("ollama")).toBe(false);
  });
});
