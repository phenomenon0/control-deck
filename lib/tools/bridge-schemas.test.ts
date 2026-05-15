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

  test("universal tool schemas reject malformed args", () => {
    const readSchema = TOOL_SCHEMAS["read_local_file"]!;
    expect(readSchema.safeParse({ path: "/etc/hostname" }).success).toBe(true);
    expect(readSchema.safeParse({}).success).toBe(false);
    expect(readSchema.safeParse({ path: "" }).success).toBe(false);

    const fetchSchema = TOOL_SCHEMAS["http_fetch"]!;
    expect(fetchSchema.safeParse({ url: "https://example.com" }).success).toBe(true);
    expect(fetchSchema.safeParse({ url: "https://example.com", method: "GET" }).success).toBe(true);
    expect(fetchSchema.safeParse({ url: "not-a-url" }).success).toBe(false);
    expect(fetchSchema.safeParse({ url: "https://example.com", method: "PARTY" }).success).toBe(false);

    const gitSchema = TOOL_SCHEMAS["git"]!;
    expect(gitSchema.safeParse({ subcommand: "status" }).success).toBe(true);
    expect(gitSchema.safeParse({ subcommand: "log", args: ["-n", "5"] }).success).toBe(true);
    expect(gitSchema.safeParse({}).success).toBe(false);
    expect(gitSchema.safeParse({ subcommand: "" }).success).toBe(false);

    const patchSchema = TOOL_SCHEMAS["apply_patch"]!;
    expect(patchSchema.safeParse({ diff: "--- a\n+++ b\n" }).success).toBe(true);
    expect(patchSchema.safeParse({}).success).toBe(false);
    expect(patchSchema.safeParse({ diff: "" }).success).toBe(false);
  });
});
