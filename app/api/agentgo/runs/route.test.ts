/**
 * /api/agentgo/runs — the AgentGo pane rides the spine.
 *
 * Why: before this route the pane POSTed {query} straight at agent-ts, so it
 * ran with agent-ts's standalone prompt + bootstrap files, an env-resolved
 * model and no tool bridge — a second, silent brain next to /api/chat. The
 * request that leaves for agent-ts must carry the same deck-assembled
 * system_prompt, resolved llm and bridge URLs /api/chat sends.
 *
 * Spies on the real module namespaces (never mock.module — registrations
 * are process-global and un-revertable on bun 1.3.4).
 */

import { afterAll, afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { NextRequest } from "next/server";
import * as actualResolve from "@/lib/engine/resolve";
import * as actualMemoryPrompt from "@/lib/memory/prompt";
import * as actualSkillIndex from "@/lib/skills/index-block";
import * as actualComfyRefs from "@/lib/comfy/refs";
import * as actualSystem from "@/lib/system";
import * as actualAgentRun from "@/app/api/chat/_lib/agent-run";
import type { AgentGOStartRunRequest } from "@/app/api/chat/_lib/agent-run";
import { POST } from "./route";

const FIXED_ROUTE = {
  provider: "test-provider",
  model: "test-model-9000",
  baseUrl: "http://llm-fixture.test/v1",
  apiKey: "fixture-key",
  source: "request" as const,
};

const sent: AgentGOStartRunRequest[] = [];

spyOn(actualResolve, "resolveModelRoute").mockImplementation((async () => FIXED_ROUTE) as never);
spyOn(actualMemoryPrompt, "renderMemoryForPrompt").mockImplementation((() => "MEMORY-BLOCK :: curated") as never);
spyOn(actualSkillIndex, "renderSkillIndex").mockImplementation((() => "") as never);
spyOn(actualComfyRefs, "renderWorkflowReferenceBlock").mockImplementation((() => "") as never);
spyOn(actualSystem, "getSystemProfile").mockImplementation(
  (() => ({ recommended: { textModel: "fallback-model" } })) as never,
);
const startSpy = spyOn(actualAgentRun, "startAgentRun").mockImplementation(
  (async (agentRequest: AgentGOStartRunRequest, ids: { runId: string }) => {
    sent.push(agentRequest);
    return ids.runId;
  }) as never,
);

function post(body: unknown): NextRequest {
  return new NextRequest("http://127.0.0.1:3333/api/agentgo/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  sent.length = 0;
  startSpy.mockClear();
});

afterAll(() => {
  mock.restore();
});

describe("POST /api/agentgo/runs", () => {
  test("the run leaves for agent-ts with the deck prompt, resolved llm and bridge URLs", async () => {
    const res = await POST(post({ query: "hi", mode: "PLAN" }));
    expect(res.status).toBe(200);
    const { run_id } = (await res.json()) as { run_id: string };
    expect(run_id).toBeTruthy();

    expect(sent).toHaveLength(1);
    const wire = sent[0];
    expect(wire.run_id).toBe(run_id);
    expect(wire.system_prompt).toContain("MEMORY-BLOCK");
    expect(wire.llm).toEqual({
      provider: FIXED_ROUTE.provider,
      model: FIXED_ROUTE.model,
      base_url: FIXED_ROUTE.baseUrl,
      api_key: FIXED_ROUTE.apiKey,
    });
    expect(wire.tool_bridge_url).toMatch(/^http/);
    expect(wire.mcp_url).toMatch(/^http/);
    expect(wire.mode).toBe("PLAN");
    expect(wire.messages.map((m) => m.content)).toEqual(["hi"]);
  });

  test("empty query → 400 and agent-ts is never contacted", async () => {
    const res = await POST(post({ query: "   " }));
    expect(res.status).toBe(400);
    expect(startSpy).not.toHaveBeenCalled();
  });
});
