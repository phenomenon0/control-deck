import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  clearBackendConfigCache,
  getBackendConfig,
  getDefaultModel,
  getRawBaseURL,
} from "./backend";

// Backup + restore LLM_* env vars across tests so each test is hermetic.

const ENV_KEYS = [
  "LLM_BACKEND",
  "LLM_BASE_URL",
  "LLM_API_KEY",
  "LLM_DEFAULT_MODEL",
  "LLM_VISION_BACKEND",
  "LLM_VISION_BASE_URL",
  "LLM_VISION_API_KEY",
  "LLM_VISION_MODEL",
  "LLM_FAST_BACKEND",
  "LLM_FAST_BASE_URL",
  "LLM_FAST_API_KEY",
  "LLM_FAST_MODEL",
] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  clearBackendConfigCache();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  clearBackendConfigCache();
});

describe("getBackendConfig — defaults", () => {
  test("no env → ollama + localhost:11434/v1, no apiKey, no defaultModel", () => {
    const cfg = getBackendConfig();
    expect(cfg.primary.type).toBe("ollama");
    expect(cfg.primary.baseURL).toBe("http://localhost:11434/v1");
    expect(cfg.primary.apiKey).toBeUndefined();
    expect(cfg.primary.defaultModel).toBeUndefined();
    expect(cfg.fast).toBeUndefined();
    expect(cfg.vision).toBeUndefined();
  });
});

describe("getBackendConfig — primary slot", () => {
  test("reads LLM_BACKEND / LLM_BASE_URL / LLM_API_KEY / LLM_DEFAULT_MODEL", () => {
    process.env.LLM_BACKEND = "openai";
    process.env.LLM_BASE_URL = "https://api.openai.com/v1";
    process.env.LLM_API_KEY = "sk-test";
    process.env.LLM_DEFAULT_MODEL = "gpt-4o";

    const cfg = getBackendConfig();
    expect(cfg.primary.type).toBe("openai");
    expect(cfg.primary.baseURL).toBe("https://api.openai.com/v1");
    expect(cfg.primary.apiKey).toBe("sk-test");
    expect(cfg.primary.defaultModel).toBe("gpt-4o");
  });

  test("strips trailing slashes from base URL", () => {
    process.env.LLM_BASE_URL = "http://localhost:11434/v1/////";
    expect(getBackendConfig().primary.baseURL).toBe("http://localhost:11434/v1");
  });
});

describe("getBackendConfig — vision slot", () => {
  test("vision slot is undefined unless LLM_VISION_BACKEND is set", () => {
    process.env.LLM_BASE_URL = "http://primary/v1";
    expect(getBackendConfig().vision).toBeUndefined();
  });

  test("vision inherits primary baseURL + apiKey when not explicitly set", () => {
    process.env.LLM_BACKEND = "ollama";
    process.env.LLM_BASE_URL = "http://primary/v1";
    process.env.LLM_API_KEY = "primary-key";
    process.env.LLM_VISION_BACKEND = "ollama";
    const { vision } = getBackendConfig();
    expect(vision).toBeDefined();
    expect(vision!.baseURL).toBe("http://primary/v1");
    expect(vision!.apiKey).toBe("primary-key");
    expect(vision!.defaultModel).toBe("llama3.2-vision:11b"); // hardcoded fallback
  });

  test("vision overrides are respected", () => {
    process.env.LLM_VISION_BACKEND = "openai";
    process.env.LLM_VISION_BASE_URL = "https://vision/v1";
    process.env.LLM_VISION_API_KEY = "vk";
    process.env.LLM_VISION_MODEL = "llava-35b";
    const { vision } = getBackendConfig();
    expect(vision).toEqual({
      type: "openai",
      baseURL: "https://vision/v1",
      apiKey: "vk",
      defaultModel: "llava-35b",
    });
  });
});

describe("getBackendConfig — fast slot", () => {
  test("fast slot undefined unless LLM_FAST_BACKEND is set", () => {
    expect(getBackendConfig().fast).toBeUndefined();
  });

  test("fast inherits + overrides correctly", () => {
    process.env.LLM_BASE_URL = "http://primary/v1";
    process.env.LLM_API_KEY = "primary";
    process.env.LLM_FAST_BACKEND = "llama_server";
    process.env.LLM_FAST_MODEL = "qwen-0.5b";
    const { fast } = getBackendConfig();
    expect(fast).toBeDefined();
    expect(fast!.type).toBe("llama_server");
    expect(fast!.baseURL).toBe("http://primary/v1"); // inherited
    expect(fast!.apiKey).toBe("primary"); // inherited
    expect(fast!.defaultModel).toBe("qwen-0.5b");
  });
});

describe("caching", () => {
  test("getBackendConfig returns the same reference across calls", () => {
    const a = getBackendConfig();
    const b = getBackendConfig();
    expect(b).toBe(a);
  });

  test("clearBackendConfigCache forces a fresh read", () => {
    process.env.LLM_BACKEND = "ollama";
    const first = getBackendConfig();
    process.env.LLM_BACKEND = "openai";
    const cached = getBackendConfig();
    expect(cached.primary.type).toBe("ollama"); // still cached
    clearBackendConfigCache();
    const fresh = getBackendConfig();
    expect(fresh.primary.type).toBe("openai");
    expect(fresh).not.toBe(first);
  });
});

describe("getDefaultModel + getRawBaseURL", () => {
  test("getDefaultModel returns primary by default", () => {
    process.env.LLM_DEFAULT_MODEL = "qwen2.5:7b";
    expect(getDefaultModel()).toBe("qwen2.5:7b");
  });

  test("getDefaultModel returns undefined for unset slots", () => {
    expect(getDefaultModel("fast")).toBeUndefined();
  });

  test("getRawBaseURL strips /v1 suffix", () => {
    process.env.LLM_BASE_URL = "http://localhost:11434/v1";
    expect(getRawBaseURL()).toBe("http://localhost:11434");
  });

  test("getRawBaseURL leaves non-v1 URLs alone", () => {
    process.env.LLM_BASE_URL = "http://localhost:8080/openai";
    expect(getRawBaseURL()).toBe("http://localhost:8080/openai");
  });

  test("getRawBaseURL throws for unconfigured slots", () => {
    expect(() => getRawBaseURL("fast")).toThrow(/fast.*not configured/);
  });
});
