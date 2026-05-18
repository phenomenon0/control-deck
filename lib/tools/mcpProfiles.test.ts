import { describe, expect, test } from "bun:test";
import { BRIDGE_TOOLS } from "./bridgeToolList";
import {
  getMcpProfileToolNames,
  isSafeCorePaneCapability,
  parseMcpProfiles,
} from "./mcpProfiles";

describe("MCP profile tool exposure", () => {
  test("defaults unknown or empty profile strings to the safe core profile", () => {
    expect(parseMcpProfiles("")).toEqual(["core"]);
    expect(parseMcpProfiles("bogus")).toEqual(["core"]);
  });

  test("deduplicates valid profile names while preserving order", () => {
    expect(parseMcpProfiles("developer, core developer unknown")).toEqual(["developer", "core"]);
  });

  test("core exposes cockpit observation/update tools but not code or desktop control", () => {
    const tools = getMcpProfileToolNames(BRIDGE_TOOLS, ["core"]);

    expect(tools.has("workspace_list_panes")).toBe(true);
    expect(tools.has("workspace_pane_call")).toBe(true);
    expect(tools.has("workspace_write_note")).toBe(true);
    expect(tools.has("workspace_show_canvas")).toBe(true);
    expect(tools.has("vector_search")).toBe(true);
    expect(tools.has("execute_code")).toBe(false);
    expect(tools.has("native_click")).toBe(false);
    expect(tools.has("generate_image")).toBe(false);
  });

  test("developer adds code execution without granting native desktop control", () => {
    const tools = getMcpProfileToolNames(BRIDGE_TOOLS, ["developer"]);

    expect(tools.has("workspace_list_panes")).toBe(true);
    expect(tools.has("execute_code")).toBe(true);
    expect(tools.has("workspace_reset")).toBe(true);
    expect(tools.has("native_click")).toBe(false);
  });

  test("creative profile exposes saved Comfy workflow tools", () => {
    const tools = getMcpProfileToolNames(BRIDGE_TOOLS, ["creative"]);

    expect(tools.has("generate_image")).toBe(true);
    expect(tools.has("comfy_workflow_list")).toBe(true);
    expect(tools.has("comfy_workflow_get")).toBe(true);
    expect(tools.has("comfy_workflow_run")).toBe(true);
  });

  test("desktop-control includes desktop-read prerequisites", () => {
    const tools = getMcpProfileToolNames(BRIDGE_TOOLS, ["desktop-control"]);

    expect(tools.has("native_tree")).toBe(true);
    expect(tools.has("native_click")).toBe(true);
  });

  test("core pane capability guard allows canvas/notes updates but blocks terminal I/O", () => {
    expect(isSafeCorePaneCapability("load_code")).toBe(true);
    expect(isSafeCorePaneCapability("canvas.load_code")).toBe(true);
    expect(isSafeCorePaneCapability("notes.replace_text")).toBe(true);
    expect(isSafeCorePaneCapability("terminal.send_keys")).toBe(false);
    expect(isSafeCorePaneCapability(null)).toBe(false);
  });
});
