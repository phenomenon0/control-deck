/**
 * Model router precedence tests.
 *
 * Covers every level of the pinned precedence chain —
 *   request → binding → settings DB → env (LLM_*) → default (local ollama)
 * — plus the legacy runtimeOverride (binding tier) and non-primary slot
 * fallthrough.
 *
 * Mocking strategy — spyOn, NEVER mock.module (bun 1.3.4: mock.module is
 * process-global and un-revertable; a partial persistence mock here gutted
 * savePersistedBinding for whichever test file evaluated after this one —
 * order differs per machine, so it only detonated on CI):
 *   - spy `resolveProviderUrl` so URLs are deterministic (no settings DB).
 *   - spy `ensureBootstrap` / `applyPersistedBindings` to no-ops so slot
 *     bindings come straight from the real in-memory runtime (bindSlot /
 *     clearAllSlots), with no provider registration or disk replay.
 *   - afterAll(mock.restore) reverts every spy for later files.
 */

import { describe, test, expect, afterAll, beforeAll, beforeEach, afterEach, mock, spyOn } from "bun:test";

import * as actualSettings from "@/lib/hardware/settings";
import * as actualBootstrap from "@/lib/inference/bootstrap";
import * as actualPersistence from "@/lib/inference/persistence";
import { bindSlot, clearAllSlots } from "@/lib/inference/runtime";
import type { Modality } from "@/lib/inference/types";

const SETTINGS_URLS: Record<string, string> = {
  ollama: "http://mock-ollama:11434",
  vllm: "http://mock-vllm:8000",
  llamacpp: "http://mock-llamacpp:8080",
  "lm-studio": "http://mock-lmstudio:1234",
  comfyui: "http://mock-comfy:8188",
};

spyOn(actualSettings, "resolveProviderUrl").mockImplementation(
  (id: string) => SETTINGS_URLS[id] ?? "http://mock-ollama:11434",
);
spyOn(actualBootstrap, "ensureBootstrap").mockImplementation(() => {});
spyOn(actualPersistence, "applyPersistedBindings").mockImplementation(() => {});

afterAll(() => {
  mock.restore();
});

type ResolveModule = typeof import("@/lib/engine/resolve");
let engine: ResolveModule;

beforeAll(async () => {
  engine = await import("@/lib/engine/resolve");
});

// Every env var the resolver (or its legacy parse) can read.
const ENV_KEYS = [
  "LLM_PROVIDER", "LLM_BACKEND", "LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL", "LLM_DEFAULT_MODEL",
  "LLM_FAST_PROVIDER", "LLM_FAST_BACKEND", "LLM_FAST_API_KEY", "LLM_FAST_BASE_URL", "LLM_FAST_MODEL",
  "LLM_VISION_PROVIDER", "LLM_VISION_API_KEY", "LLM_VISION_BASE_URL", "LLM_VISION_MODEL",
  "LLM_EMBEDDING_PROVIDER", "LLM_EMBEDDING_API_KEY", "LLM_EMBEDDING_BASE_URL", "LLM_EMBEDDING_MODEL",
  "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY", "DEEPSEEK_API_KEY",
  "OPENROUTER_API_KEY", "HUGGINGFACE_API_KEY",
] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  clearAllSlots();
  engine.setRuntimeProvider(null);
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  clearAllSlots();
  engine.setRuntimeProvider(null);
});

function bind(
  modality: Modality,
  slotName: string,
  providerId: string,
  config: { model?: string; baseURL?: string; apiKey?: string } = {},
): void {
  bindSlot({ modality, slotName, providerId, config: { providerId, ...config } });
}

// ── Level 5: default ───────────────────────────────────────────────

describe("default level", () => {
  test("nothing configured → local ollama via settings chain", async () => {
    const route = await engine.resolveModelRoute();
    expect(route).toEqual({
      provider: "ollama",
      model: "qwen3:0.6b",
      baseUrl: "http://mock-ollama:11434/v1",
      apiKey: undefined,
      source: "default",
    });
  });
});

// ── Level 4: env (LLM_* vocabulary) ────────────────────────────────

describe("env level", () => {
  test("full LLM_* anthropic config is expressed verbatim", async () => {
    process.env.LLM_PROVIDER = "anthropic";
    process.env.LLM_API_KEY = "sk-ant-test";
    process.env.LLM_MODEL = "claude-3-5-sonnet-20241022";
    const route = await engine.resolveModelRoute();
    expect(route).toEqual({
      provider: "anthropic",
      model: "claude-3-5-sonnet-20241022",
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-ant-test",
      source: "env",
    });
  });

  test("LLM_BASE_URL + LLM_MODEL only → ollama identity on the env URL", async () => {
    process.env.LLM_BASE_URL = "http://custom:9999/v1";
    process.env.LLM_MODEL = "my-model";
    const route = await engine.resolveModelRoute();
    expect(route.provider).toBe("ollama");
    expect(route.baseUrl).toBe("http://custom:9999/v1");
    expect(route.model).toBe("my-model");
    expect(route.source).toBe("env");
  });

  test("per-provider env key fills apiKey when LLM_API_KEY is unset", async () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-openai";
    const route = await engine.resolveModelRoute();
    expect(route.apiKey).toBe("sk-openai");
    expect(route.baseUrl).toBe("https://api.openai.com/v1");
  });

  test("local provider with no LLM_BASE_URL resolves URL via settings chain", async () => {
    process.env.LLM_PROVIDER = "vllm";
    const route = await engine.resolveModelRoute();
    expect(route.baseUrl).toBe("http://mock-vllm:8000/v1");
    expect(route.source).toBe("env");
    // vllm has no catalog default models → ultimate ollama fallback
    expect(route.model).toBe("qwen3:0.6b");
  });
});

// ── Level 2: slot binding (+ legacy override) ──────────────────────

describe("binding level", () => {
  test("binding wins over env, values verbatim", async () => {
    process.env.LLM_PROVIDER = "anthropic";
    process.env.LLM_API_KEY = "sk-ant";
    process.env.LLM_MODEL = "claude-x";
    bind("text", "primary", "ollama", { model: "b-model", baseURL: "http://b:1/v1", apiKey: "bk" });
    const route = await engine.resolveModelRoute();
    expect(route).toEqual({
      provider: "ollama",
      model: "b-model",
      baseUrl: "http://b:1/v1",
      apiKey: "bk",
      source: "binding",
    });
  });

  test("binding without baseURL resolves the local URL via settings chain", async () => {
    bind("text", "primary", "vllm", { model: "v-m" });
    const route = await engine.resolveModelRoute();
    expect(route.baseUrl).toBe("http://mock-vllm:8000/v1");
    expect(route.model).toBe("v-m");
    expect(route.apiKey).toBeUndefined();
    expect(route.source).toBe("binding");
  });

  test("binding for an unknown provider without baseURL is ignored", async () => {
    bind("text", "primary", "comfyui");
    const route = await engine.resolveModelRoute();
    expect(route.provider).toBe("ollama");
    expect(route.source).toBe("default");
  });

  test("legacy runtimeOverride sits in the binding tier: beats env, loses to a real binding", async () => {
    process.env.LLM_PROVIDER = "anthropic";
    process.env.LLM_API_KEY = "sk-ant";
    engine.setRuntimeProvider({ provider: "openai", apiKey: "sk-rt", model: "gpt-4o" });

    const overrideRoute = await engine.resolveModelRoute();
    expect(overrideRoute).toEqual({
      provider: "openai",
      model: "gpt-4o",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-rt",
      source: "binding",
    });

    bind("text", "primary", "ollama", { model: "b-model" });
    const boundRoute = await engine.resolveModelRoute();
    expect(boundRoute.provider).toBe("ollama");
    expect(boundRoute.model).toBe("b-model");
    expect(boundRoute.source).toBe("binding");
  });
});

// ── Level 1: explicit request pick ─────────────────────────────────

describe("request level", () => {
  test("model-only pick inherits provider/baseUrl/apiKey from below", async () => {
    process.env.LLM_PROVIDER = "anthropic";
    process.env.LLM_API_KEY = "sk-ant";
    const route = await engine.resolveModelRoute({ requested: { model: "claude-opus" } });
    expect(route).toEqual({
      provider: "anthropic",
      model: "claude-opus",
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-ant",
      source: "request",
    });
  });

  test("engine pick (settings vocab) normalizes and inherits the configured model", async () => {
    process.env.LLM_MODEL = "cfg-model";
    const route = await engine.resolveModelRoute({ requested: { provider: "llamacpp" } });
    expect(route.provider).toBe("llama_server");
    expect(route.baseUrl).toBe("http://mock-llamacpp:8080/v1");
    expect(route.model).toBe("cfg-model");
    expect(route.source).toBe("request");
  });

  test("request beats binding", async () => {
    bind("text", "primary", "ollama", { model: "b-model" });
    const route = await engine.resolveModelRoute({
      requested: { provider: "vllm", model: "req-model" },
    });
    expect(route.provider).toBe("vllm");
    expect(route.model).toBe("req-model");
    expect(route.baseUrl).toBe("http://mock-vllm:8000/v1");
    expect(route.source).toBe("request");
  });

  test("cloud provider pick gets catalog URL, catalog default model, and per-provider env key", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-a";
    const route = await engine.resolveModelRoute({ requested: { provider: "anthropic" } });
    expect(route.provider).toBe("anthropic");
    expect(route.model).toBe("claude-sonnet-4-20250514");
    expect(route.baseUrl).toBe("https://api.anthropic.com");
    expect(route.apiKey).toBe("sk-a");
    expect(route.source).toBe("request");
  });
});

// ── Non-primary slots ──────────────────────────────────────────────

describe("non-primary slots", () => {
  test("text::fast reads the LLM_FAST_* vocabulary", async () => {
    process.env.LLM_FAST_PROVIDER = "ollama";
    process.env.LLM_FAST_MODEL = "tiny-model";
    const route = await engine.resolveModelRoute({ slot: "text::fast" });
    expect(route).toEqual({
      provider: "ollama",
      model: "tiny-model",
      baseUrl: "http://mock-ollama:11434/v1",
      apiKey: undefined,
      source: "env",
    });
  });

  test("text::fast with nothing configured falls through to the primary chain", async () => {
    process.env.LLM_PROVIDER = "anthropic";
    process.env.LLM_API_KEY = "sk-ant";
    process.env.LLM_MODEL = "claude-x";
    const route = await engine.resolveModelRoute({ slot: "text::fast" });
    expect(route.provider).toBe("anthropic");
    expect(route.model).toBe("claude-x");
    expect(route.source).toBe("env");
  });

  test("binding on text::fast does not leak into text::primary", async () => {
    bind("text", "fast", "ollama", { model: "fast-model" });
    const fastRoute = await engine.resolveModelRoute({ slot: "text::fast" });
    expect(fastRoute.model).toBe("fast-model");
    expect(fastRoute.source).toBe("binding");

    const primaryRoute = await engine.resolveModelRoute();
    expect(primaryRoute.model).toBe("qwen3:0.6b");
    expect(primaryRoute.source).toBe("default");
  });

  test("vision::primary binding with an explicit baseURL (openai-compat shape)", async () => {
    bind("vision", "primary", "openai-compat", { model: "qwen3.5-9b", baseURL: "http://mm:9000/v1" });
    const route = await engine.resolveModelRoute({ slot: "vision::primary" });
    expect(route).toEqual({
      provider: "openai-compat",
      model: "qwen3.5-9b",
      baseUrl: "http://mm:9000/v1",
      apiKey: undefined,
      source: "binding",
    });
  });
});
