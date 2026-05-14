import { describe, expect, test } from "bun:test";
import { BRIDGE_TOOLS } from "@/lib/tools/bridgeToolList";
import type { McpProfile } from "@/lib/tools/mcpProfiles";
import { registerBridgeTools } from "./bridge-tools";

function registeredToolNames(
  env: {
    CONTROL_DECK_MCP_EXPOSE?: string;
    CONTROL_DECK_MCP_PROFILE?: string;
  },
  profiles?: readonly McpProfile[],
): string[] {
  const prevExpose = process.env.CONTROL_DECK_MCP_EXPOSE;
  const prevProfile = process.env.CONTROL_DECK_MCP_PROFILE;
  const names: string[] = [];
  const server = {
    registerTool(name: string) {
      names.push(name);
    },
  } as unknown as Parameters<typeof registerBridgeTools>[0];

  try {
    if (env.CONTROL_DECK_MCP_EXPOSE === undefined) delete process.env.CONTROL_DECK_MCP_EXPOSE;
    else process.env.CONTROL_DECK_MCP_EXPOSE = env.CONTROL_DECK_MCP_EXPOSE;

    if (env.CONTROL_DECK_MCP_PROFILE === undefined) delete process.env.CONTROL_DECK_MCP_PROFILE;
    else process.env.CONTROL_DECK_MCP_PROFILE = env.CONTROL_DECK_MCP_PROFILE;

    registerBridgeTools(server, { profiles });
    return names;
  } finally {
    if (prevExpose === undefined) delete process.env.CONTROL_DECK_MCP_EXPOSE;
    else process.env.CONTROL_DECK_MCP_EXPOSE = prevExpose;

    if (prevProfile === undefined) delete process.env.CONTROL_DECK_MCP_PROFILE;
    else process.env.CONTROL_DECK_MCP_PROFILE = prevProfile;
  }
}

describe("registerBridgeTools MCP profile filtering", () => {
  test("registers only safe core tools by default", () => {
    const names = registeredToolNames({});

    expect(names).toContain("workspace_list_panes");
    expect(names).toContain("workspace_pane_call");
    expect(names).toContain("vector_search");
    expect(names).not.toContain("execute_code");
    expect(names).not.toContain("native_click");
  });

  test("developer profile adds code and admin workspace tools", () => {
    const names = registeredToolNames({ CONTROL_DECK_MCP_PROFILE: "developer" });

    expect(names).toContain("workspace_list_panes");
    expect(names).toContain("execute_code");
    expect(names).toContain("workspace_reset");
    expect(names).not.toContain("native_click");
  });

  test("CONTROL_DECK_MCP_EXPOSE takes precedence over CONTROL_DECK_MCP_PROFILE", () => {
    const names = registeredToolNames({
      CONTROL_DECK_MCP_PROFILE: "developer",
      CONTROL_DECK_MCP_EXPOSE: "core",
    });

    expect(names).toContain("workspace_list_panes");
    expect(names).not.toContain("execute_code");
  });

  test("explicit profiles override env profile resolution for server factories", () => {
    const names = registeredToolNames({ CONTROL_DECK_MCP_PROFILE: "core" }, ["developer"]);

    expect(names).toContain("workspace_list_panes");
    expect(names).toContain("execute_code");
    expect(names).toContain("workspace_reset");
    expect(names).not.toContain("native_click");
  });

  test("full profile registers the canonical bridge surface", () => {
    const names = registeredToolNames({ CONTROL_DECK_MCP_PROFILE: "full" });

    expect(new Set(names)).toEqual(BRIDGE_TOOLS);
  });
});
