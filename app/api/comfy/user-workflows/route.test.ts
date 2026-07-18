import { afterAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { NextRequest } from "next/server";
import * as actualUserdata from "@/lib/comfy/userdata";

const state: {
  loadedPaths: string[];
  saved: Array<{ path: string; workflowJson: unknown }>;
} = {
  loadedPaths: [],
  saved: [],
};

// Spies on the real userdata module, not mock.module: bun module mocks are
// process-global and cannot be undone, so they leak into later test files.
// Spies keep the real export shape and mock.restore() reverts them.
const userdataSpies = {
  comfyWorkflowPath: spyOn(actualUserdata, "comfyWorkflowPath").mockImplementation(
    ((slugOrName: string) => `workflows/${slugOrName.toLowerCase()}.json`) as never,
  ),
  getComfyUserWorkflow: spyOn(actualUserdata, "getComfyUserWorkflow").mockImplementation(
    (async (path: string) => {
      state.loadedPaths.push(path);
      return { nodes: [], links: [], path };
    }) as never,
  ),
  listComfyUserWorkflows: spyOn(actualUserdata, "listComfyUserWorkflows").mockImplementation(
    (async () => [
      { name: "FLUX-GGUF.json", path: "workflows/FLUX-GGUF.json", size: 42 },
    ]) as never,
  ),
  saveComfyUserWorkflow: spyOn(actualUserdata, "saveComfyUserWorkflow").mockImplementation(
    (async (path: string, workflowJson: unknown) => {
      state.saved.push({ path, workflowJson });
      return { name: path.split("/").pop() ?? path, path, size: 42 };
    }) as never,
  ),
};

const { GET, POST } = await import("./route");

afterAll(() => {
  // Revert the userdata spies so later test files see real behaviour.
  for (const spy of Object.values(userdataSpies)) spy.mockClear();
  mock.restore();
});

beforeEach(() => {
  state.loadedPaths.length = 0;
  state.saved.length = 0;
});

function nextReq(url: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(url, init);
}

describe("/api/comfy/user-workflows", () => {
  test("passes encoded Comfy workflow paths through to the loader", async () => {
    const res = await GET(nextReq("http://localhost/api/comfy/user-workflows?path=workflows%2FFLUX-GGUF.json"));
    const body = (await res.json()) as { workflowJson: { path: string } };

    expect(res.status).toBe(200);
    expect(state.loadedPaths).toEqual(["workflows/FLUX-GGUF.json"]);
    expect(body.workflowJson.path).toBe("workflows/FLUX-GGUF.json");
  });

  test("preserves explicit Comfy paths when saving UI graph JSON", async () => {
    const workflowJson = { nodes: [], links: [] };
    const res = await POST(
      nextReq("http://localhost/api/comfy/user-workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: "workflows/FLUX-GGUF.json",
          slug: "flux-gguf",
          workflowJson,
        }),
      }),
    );
    const body = (await res.json()) as { file: { path: string } };

    expect(res.status).toBe(201);
    expect(state.saved).toEqual([{ path: "workflows/FLUX-GGUF.json", workflowJson }]);
    expect(body.file.path).toBe("workflows/FLUX-GGUF.json");
  });

  test("rejects API prompt JSON for Comfy user workflow saves", async () => {
    const res = await POST(
      nextReq("http://localhost/api/comfy/user-workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: "workflows/FLUX-GGUF.json",
          workflowJson: { "1": { class_type: "KSampler", inputs: {} } },
        }),
      }),
    );

    expect(res.status).toBe(400);
    expect(state.saved).toEqual([]);
  });
});
