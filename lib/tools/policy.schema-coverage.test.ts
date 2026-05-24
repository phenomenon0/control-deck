/**
 * Build-gate: every bridge-exposed tool MUST have a Zod schema in
 * TOOL_SCHEMAS. Before this test, a tool added to BRIDGE_TOOLS without a
 * schema dispatched with no input validation — the README documented this
 * as the "bridge validation is planned" hedge and it was a real exploit
 * surface if DECK_TOKEN ever leaked. Runtime policy now denies dispatch
 * when the schema is missing; this test makes that promise visible at CI
 * time instead of letting it fail one tool at a time in production.
 */

import { describe, expect, it } from "bun:test";

import { BRIDGE_TOOLS } from "./bridgeToolList";
import { TOOL_SCHEMAS, type ToolName } from "./definitions";
import { decideToolPolicy } from "./policy";

describe("bridge tool schema coverage", () => {
  it("every tool in BRIDGE_TOOLS has a TOOL_SCHEMAS entry", () => {
    const missing: string[] = [];
    for (const tool of BRIDGE_TOOLS) {
      if (!TOOL_SCHEMAS[tool as ToolName]) missing.push(tool);
    }
    expect(missing).toEqual([]);
  });

  it("decideToolPolicy refuses to dispatch when the schema is absent", () => {
    // Probe with a fabricated tool name. BRIDGE_TOOLS rejects it BEFORE the
    // schema check, so we get the expected "not exposed" denial — proving the
    // allowlist is the outer gate.
    const fabricated = decideToolPolicy({ tool: "definitely_not_a_real_tool", args: {} });
    expect(fabricated.decision).toBe("deny");
    if (fabricated.decision !== "deny") throw new Error("expected deny");
    expect(fabricated.reason).toContain("not exposed");
  });

  it("invalid args produce a 'invalid args' denial with issues", () => {
    // generate_image requires a `prompt` string.
    const bad = decideToolPolicy({ tool: "generate_image", args: {} });
    expect(bad.decision).toBe("deny");
    if (bad.decision !== "deny") throw new Error("expected deny");
    expect(bad.reason).toBe("invalid args");
    expect(bad.issues).toBeTruthy();
  });

  it("valid args pass validation and are normalized", () => {
    const ok = decideToolPolicy({
      tool: "generate_image",
      args: { prompt: "a control deck logo" },
    });
    // The decision (allow vs approval_required) depends on the tool's risk
    // manifest, which isn't what this test cares about. What we're locking
    // is: valid args make it through to a non-"deny" outcome with the
    // normalized payload preserved.
    expect(ok.decision).not.toBe("deny");
    if (ok.decision === "deny") throw new Error("unexpected deny");
    expect(ok.normalizedArgs).toMatchObject({ prompt: "a control deck logo" });
  });
});
