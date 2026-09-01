import { afterAll, afterEach, expect, spyOn, test } from "bun:test";
import { unloadLane } from "./lane-adapters";

const fetchSpy = spyOn(globalThis, "fetch");
afterEach(() => fetchSpy.mockClear());
afterAll(() => fetchSpy.mockRestore());

/** llama-swap answers 404 on every unload path; Ollama reports `models`. */
function stubBackends(ollamaModels: string[]) {
  fetchSpy.mockImplementation((async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/ps")) return Response.json({ models: ollamaModels.map((name) => ({ name })) });
    if (url.includes("/api/generate")) return new Response("{}", { status: 200 });
    return new Response("nope", { status: 404 });
  }) as never);
}

test("chat lane: a failed llama-swap unload is not masked by an idle Ollama", async () => {
  stubBackends([]);
  const r = await unloadLane("chat", "qwen3.6");
  expect(r.ok).toBe(false);
  expect(r.via).toBe("llama-swap");
});

test("chat lane: Ollama actually holding a model still counts as the unload", async () => {
  stubBackends(["llama3"]);
  const r = await unloadLane("chat");
  expect(r.ok).toBe(true);
  expect(r.via).toBe("ollama keep_alive:0");
});
