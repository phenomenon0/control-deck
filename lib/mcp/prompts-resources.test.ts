import { describe, expect, test } from "bun:test";
import type { McpProfile } from "@/lib/tools/mcpProfiles";
import { createDeckMcpServer } from "./server";
import { registerDeckMcpPrompts } from "./prompts";
import { registerDeckMcpResources } from "./resources";

interface CapturedPrompt {
  config: { description?: string };
  callback: (args?: Record<string, string>) => unknown | Promise<unknown>;
}

interface CapturedResource {
  uri: string;
  config: { description?: string; mimeType?: string };
  callback: (uri: URL) => unknown | Promise<unknown>;
}

function fakePromptServer() {
  const prompts = new Map<string, CapturedPrompt>();
  const server = {
    registerPrompt(name: string, config: CapturedPrompt["config"], callback: CapturedPrompt["callback"]) {
      prompts.set(name, { config, callback });
    },
  } as unknown as Parameters<typeof registerDeckMcpPrompts>[0];
  return { server, prompts };
}

function fakeResourceServer() {
  const resources = new Map<string, CapturedResource>();
  const server = {
    registerResource(
      name: string,
      uri: string,
      config: CapturedResource["config"],
      callback: CapturedResource["callback"],
    ) {
      resources.set(name, { uri, config, callback });
    },
  } as unknown as Parameters<typeof registerDeckMcpResources>[0];
  return { server, resources };
}

function textFromPromptResult(result: unknown): string {
  const messages = (result as { messages: Array<{ content: { text: string } }> }).messages;
  return messages.map((message) => message.content.text).join("\n");
}

function textFromResourceResult(result: unknown): string {
  const contents = (result as { contents: Array<{ text: string }> }).contents;
  return contents.map((content) => content.text).join("\n");
}

describe("Control Deck MCP server integration", () => {
  test("server factory advertises and registers prompts and resources", () => {
    const server = createDeckMcpServer({
      bridgeUrl: "http://localhost:3333/api/tools/bridge",
      profiles: ["developer"],
    }) as unknown as {
      _registeredPrompts?: Record<string, unknown>;
      _registeredResources?: Record<string, unknown>;
      _registeredTools?: Record<string, unknown>;
    };

    expect(Object.prototype.hasOwnProperty.call(server._registeredPrompts ?? {}, "local_agent_cockpit")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(server._registeredResources ?? {}, "control-deck://agent-handbook")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(server._registeredTools ?? {}, "execute_code")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(server._registeredTools ?? {}, "native_click")).toBe(false);
  });
});

describe("Control Deck MCP prompts", () => {
  test("registers cockpit prompts that teach profile-gated observe/act/verify behavior", async () => {
    const { server, prompts } = fakePromptServer();

    registerDeckMcpPrompts(server, { profiles: ["core"] });

    expect(prompts.has("local_agent_cockpit")).toBe(true);
    expect(prompts.has("workspace_operator")).toBe(true);
    expect(prompts.has("developer_sandbox")).toBe(true);
    expect(prompts.has("desktop_automation_safe")).toBe(true);
    expect(prompts.has("creative_media_operator")).toBe(true);

    const cockpit = prompts.get("local_agent_cockpit");
    expect(cockpit).toBeDefined();
    const text = textFromPromptResult(await cockpit!.callback({ task: "write a note" }));

    expect(text).toContain("Control Deck");
    expect(text).toContain("Active MCP profiles: core");
    expect(text).toContain("workspace_get_state");
    expect(text).toContain("Only use tools visible in the active MCP profile");
    expect(text).toContain("Verify after every write");
  });
});

describe("Control Deck MCP resources", () => {
  test("registers profile-aware handbook, manifest, platform, and workspace state resources", async () => {
    const { server, resources } = fakeResourceServer();

    registerDeckMcpResources(server, {
      profiles: ["core"],
      bridgeUrl: "http://localhost:3333/api/tools/bridge",
      readWorkspaceState: async () => ({ success: true, paneCount: 2 }),
    });

    expect(resources.get("agent-handbook")?.uri).toBe("control-deck://agent-handbook");
    expect(resources.get("tool-manifest")?.uri).toBe("control-deck://tool-manifest");
    expect(resources.get("platform-capabilities")?.uri).toBe("control-deck://platform/capabilities");
    expect(resources.get("workspace-state")?.uri).toBe("control-deck://workspace/state");

    const manifestResource = resources.get("tool-manifest");
    expect(manifestResource).toBeDefined();
    const manifest = JSON.parse(
      textFromResourceResult(await manifestResource!.callback(new URL(manifestResource!.uri))),
    ) as { activeProfiles: McpProfile[]; tools: Array<{ name: string }> };

    expect(manifest.activeProfiles).toEqual(["core"]);
    expect(manifest.tools.some((tool) => tool.name === "workspace_get_state")).toBe(true);
    expect(manifest.tools.some((tool) => tool.name === "execute_code")).toBe(false);

    const stateResource = resources.get("workspace-state");
    expect(stateResource).toBeDefined();
    const state = JSON.parse(
      textFromResourceResult(await stateResource!.callback(new URL(stateResource!.uri))),
    );
    expect(state).toEqual({ success: true, paneCount: 2 });
  });
});
