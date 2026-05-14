import { describe, expect, test } from "bun:test";
import { BRIDGE_TOOLS } from "./bridgeDispatch";
import { TOOL_SCHEMAS } from "./definitions";

const bridgeToolNames = [...BRIDGE_TOOLS].sort();

describe("bridge tool schemas", () => {
  test("every MCP/bridge-exposed tool has a Zod args schema", () => {
    const missing = bridgeToolNames.filter((tool) => !(tool in TOOL_SCHEMAS));
    expect(missing).toEqual([]);
  });

  test("argument-bearing workspace tools expose schemas to MCP clients", () => {
    for (const tool of [
      "workspace_open_pane",
      "workspace_close_pane",
      "workspace_focus_pane",
      "workspace_pane_call",
      "workspace_write_note",
      "workspace_show_canvas",
    ]) {
      expect(TOOL_SCHEMAS[tool as keyof typeof TOOL_SCHEMAS]).toBeDefined();
    }
  });
});
