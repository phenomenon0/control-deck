import { describe, expect, test } from "bun:test";

import { comfyWorkflowPath } from "./userdata";

describe("Comfy user workflow helpers", () => {
  test("normalizes workflow names into Comfy user workflow paths", () => {
    expect(comfyWorkflowPath("Flux GGUF / Draft!.json")).toBe("workflows/flux-gguf-draft.json");
    expect(comfyWorkflowPath("SDXL Simple")).toBe("workflows/sdxl-simple.json");
  });
});
