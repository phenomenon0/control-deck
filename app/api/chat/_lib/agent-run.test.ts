/**
 * Tests for app/api/chat/_lib/agent-run.ts — the wire message sanitiser
 * and the pinned /runs request shape. startAgentRun itself is network I/O
 * and is covered by the route load smoke.
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { ModelRoute } from "@/lib/engine/resolve";
import { buildAgentMessages, buildStartRunRequest } from "./agent-run";

const ENV_KEYS = ["WORKSPACE_ROOT", "AGENT_MAX_STEPS"] as const;
const savedEnv = new Map<string, string | undefined>();

function setEnv(key: (typeof ENV_KEYS)[number], value: string | undefined) {
  if (!savedEnv.has(key)) savedEnv.set(key, process.env[key]);
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    const original = savedEnv.get(key);
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
    savedEnv.delete(key);
  }
});

describe("buildAgentMessages", () => {
  test("passes user content through untouched", () => {
    const out = buildAgentMessages([{ role: "user", content: "keep ![x](http://y/a.png)" }]);
    expect(out).toEqual([{ role: "user", content: "keep ![x](http://y/a.png)" }]);
  });

  test("strips fake tool-call patterns from assistant history", () => {
    const out = buildAgentMessages([
      { role: "assistant", content: "done ![plot](http://x/y.png)" },
    ]);
    expect(out).toEqual([{ role: "assistant", content: "done" }]);
  });

  test("replaces assistant turns that strip to nothing with a placeholder", () => {
    const out = buildAgentMessages([
      { role: "assistant", content: "Here is an image of a cat." },
    ]);
    expect(out).toEqual([
      { role: "assistant", content: "[Previous response contained only generated content]" },
    ]);
  });

  test("drops whitespace-only user messages", () => {
    const out = buildAgentMessages([
      { role: "user", content: "hi" },
      { role: "user", content: "   " },
    ]);
    expect(out).toEqual([{ role: "user", content: "hi" }]);
  });

  test("preserves order and roles across a conversation", () => {
    const out = buildAgentMessages([
      { role: "user", content: "one" },
      { role: "assistant", content: "two" },
      { role: "user", content: "three" },
    ]);
    expect(out.map(m => m.role)).toEqual(["user", "assistant", "user"]);
    expect(out.map(m => m.content)).toEqual(["one", "two", "three"]);
  });
});

describe("buildStartRunRequest", () => {
  const route: ModelRoute = {
    provider: "ollama",
    model: "qwen3:4b",
    baseUrl: "http://localhost:11434/v1",
    apiKey: undefined,
    source: "env",
  };

  const base = {
    messages: [{ role: "user" as const, content: "hi" }],
    threadId: "t1",
    runId: "r1",
    assembledSystemPrompt: "SYS",
    route,
    selectedModel: "qwen3:4b",
    toolBridgeUrl: "http://deck/api/tools/bridge",
    mcpUrl: "http://deck/api/mcp/tools",
  };

  test("assembles the pinned wire shape", () => {
    setEnv("WORKSPACE_ROOT", undefined);
    setEnv("AGENT_MAX_STEPS", undefined);
    expect(buildStartRunRequest(base)).toEqual({
      messages: [{ role: "user", content: "hi" }],
      thread_id: "t1",
      system_prompt: "SYS",
      run_id: "r1",
      workspace_root: undefined,
      mode: "BUILD",
      max_steps: 25,
      llm: {
        provider: "ollama",
        model: "qwen3:4b",
        base_url: "http://localhost:11434/v1",
        api_key: null,
      },
      tool_bridge_url: "http://deck/api/tools/bridge",
      mcp_url: "http://deck/api/mcp/tools",
    });
  });

  test("omits system_prompt when the assembled prompt is empty", () => {
    const out = buildStartRunRequest({ ...base, assembledSystemPrompt: "" });
    expect(out.system_prompt).toBeUndefined();
  });

  test("passes a resolved api key through", () => {
    const out = buildStartRunRequest({ ...base, route: { ...route, apiKey: "sk-1" } });
    expect(out.llm?.api_key).toBe("sk-1");
  });

  test("honours env overrides for workspace and step budget", () => {
    setEnv("WORKSPACE_ROOT", "/tmp/ws");
    setEnv("AGENT_MAX_STEPS", "7");
    const out = buildStartRunRequest(base);
    expect(out.workspace_root).toBe("/tmp/ws");
    expect(out.max_steps).toBe(7);
  });
});
