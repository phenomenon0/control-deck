import { describe, expect, test } from "bun:test";

import { comfyWorkflowPath, normalizeComfyUserWorkflowPath } from "./userdata";

describe("Comfy user workflow helpers", () => {
  test("normalizes workflow names into Comfy user workflow paths", () => {
    expect(comfyWorkflowPath("Flux GGUF / Draft!.json")).toBe("workflows/flux-gguf-draft.json");
    expect(comfyWorkflowPath("SDXL Simple")).toBe("workflows/sdxl-simple.json");
  });

  test("preserves existing Comfy workflow filenames when loading or overwriting", () => {
    expect(normalizeComfyUserWorkflowPath("workflows/FLUX-GGUF.json")).toBe("workflows/FLUX-GGUF.json");
    expect(normalizeComfyUserWorkflowPath("SDXL Simple.json")).toBe("workflows/SDXL Simple.json");
  });

  test("rejects nested or unsafe Comfy workflow paths", () => {
    expect(() => normalizeComfyUserWorkflowPath("workflows/nested/file.json")).toThrow();
    expect(() => normalizeComfyUserWorkflowPath("workflows/..json")).toThrow();
    expect(() => normalizeComfyUserWorkflowPath("workflows/.json")).toThrow();
  });
});
