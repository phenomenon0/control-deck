import { describe, expect, test } from "bun:test";

import {
  applyWorkflowParams,
  defaultEstimateForLane,
  detectWorkflowFormat,
  normalizeWorkflowSlug,
  sanitizeWorkflowInput,
} from "./workflows";

describe("Comfy workflow helpers", () => {
  test("detects UI graph and API prompt formats", () => {
    expect(detectWorkflowFormat({ nodes: [], links: [] })).toBe("ui_graph");
    expect(detectWorkflowFormat({ "1": { class_type: "KSampler", inputs: {} } })).toBe("api_prompt");
    expect(detectWorkflowFormat({ hello: "world" })).toBeNull();
  });

  test("normalizes slugs and applies defaults", () => {
    expect(normalizeWorkflowSlug("  Flux GGUF / Draft! ")).toBe("flux-gguf-draft");
    const clean = sanitizeWorkflowInput({
      name: "Flux Draft",
      workflowJson: { "1": { class_type: "KSampler", inputs: {} } },
      tags: ["Flux", "bad tag!", "flux"],
      lane: "3d",
    });
    expect(clean.slug).toBe("flux-draft");
    expect(clean.format).toBe("api_prompt");
    expect(clean.tags).toEqual(["flux"]);
    expect(clean.estimateMb).toBe(defaultEstimateForLane("3d"));
  });

  test("patches API prompt params by node input key", () => {
    const workflow = {
      "6": { class_type: "CLIPTextEncode", inputs: { text: "old" } },
      "9": { class_type: "KSampler", inputs: { seed: 1 } },
    };
    const patched = applyWorkflowParams(workflow, {
      "6.text": "new prompt",
      "9.inputs.seed": 42,
    }) as typeof workflow;

    expect(patched["6"].inputs.text).toBe("new prompt");
    expect(patched["9"].inputs.seed).toBe(42);
    expect(workflow["6"].inputs.text).toBe("old");
  });
});
