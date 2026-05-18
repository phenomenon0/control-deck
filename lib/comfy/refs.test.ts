import { describe, expect, test } from "bun:test";

import { extractWorkflowRefs } from "./refs";

describe("Comfy workflow references", () => {
  test("extracts unique @workflow slugs in message text", () => {
    expect(
      extractWorkflowRefs("run @workflow/flux-draft then compare @workflow/flux-draft with @workflow/sdxl-final"),
    ).toEqual(["flux-draft", "sdxl-final"]);
  });

  test("ignores malformed workflow references", () => {
    expect(extractWorkflowRefs("@workflow/ @workflow/UPPER @workflow/-bad @workflow good")).toEqual([]);
  });
});
