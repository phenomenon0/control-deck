import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { BRIDGE_TOOLS } from "@/lib/tools/bridgeToolList";
import { TOOL_DEFINITIONS } from "@/lib/tools/definitions";
import { getManifest } from "@/lib/tools/manifest";
import {
  getMcpProfileToolNames,
  mcpProfileSummary,
  resolveMcpProfiles,
  type McpProfile,
} from "@/lib/tools/mcpProfiles";
import { callToolBridgeHttp } from "./http-bridge";
import { buildLocalAgentCockpitPrompt } from "./prompts";

export interface RegisterDeckMcpResourcesOptions {
  profiles?: readonly McpProfile[];
  bridgeUrl?: string;
  deckUrl?: string;
  workspaceUrl?: string;
  readWorkspaceState?: () => Promise<unknown> | unknown;
}

export function registerDeckMcpResources(
  server: McpServer,
  opts: RegisterDeckMcpResourcesOptions = {},
): void {
  const profiles = [...(opts.profiles ?? resolveMcpProfiles())];
  const deckUrl = opts.deckUrl ?? "http://localhost:3333/deck";
  const workspaceUrl = opts.workspaceUrl ?? "http://localhost:3333/deck/workspace";

  server.registerResource(
    "agent-handbook",
    "control-deck://agent-handbook",
    {
      title: "Control Deck Agent Handbook",
      description: "Profile-aware Control Deck operating handbook for MCP agents.",
      mimeType: "text/markdown",
    },
    (uri) => markdownResource(uri, buildAgentHandbookResource(profiles)),
  );

  server.registerResource(
    "tool-manifest",
    "control-deck://tool-manifest",
    {
      title: "Control Deck Tool Manifest",
      description: "Active MCP profile, exposed tools, risk metadata, and side-effect metadata.",
      mimeType: "application/json",
    },
    (uri) => jsonResource(uri, buildToolManifestResource(profiles)),
  );

  server.registerResource(
    "platform-capabilities",
    "control-deck://platform/capabilities",
    {
      title: "Control Deck Platform Capabilities",
      description: "Runtime URLs, platform notes, workspace requirements, and native-tool availability.",
      mimeType: "application/json",
    },
    (uri) => jsonResource(uri, buildPlatformCapabilitiesResource({ deckUrl, workspaceUrl, bridgeUrl: opts.bridgeUrl })),
  );

  server.registerResource(
    "workspace-state",
    "control-deck://workspace/state",
    {
      title: "Control Deck Workspace State",
      description: "Current workspace snapshot via workspace_get_state; requires an open /deck/workspace client.",
      mimeType: "application/json",
    },
    async (uri) => {
      const state = opts.readWorkspaceState
        ? await opts.readWorkspaceState()
        : await readWorkspaceStateFromBridge(opts.bridgeUrl, profiles);
      return jsonResource(uri, state);
    },
  );
}

export function buildAgentHandbookResource(
  profiles: readonly McpProfile[] = resolveMcpProfiles(),
): string {
  return `# Control Deck MCP Agent Handbook

${buildLocalAgentCockpitPrompt(profiles)}

## MCP resources

- control-deck://agent-handbook — this handbook.
- control-deck://tool-manifest — active profile and exposed tool risk metadata.
- control-deck://workspace/state — current workspace_get_state snapshot when /deck/workspace is open.
- control-deck://platform/capabilities — runtime URLs, OS support notes, and workspace requirements.

## Operating north star

Use Control Deck as a local AI cockpit: observe visible state, act through typed tools, verify in panes/artifacts, and report exact results to the user. Prefer small safe profiles and semantic macros over broad owner-mode tool access.
`;
}

export function buildToolManifestResource(
  profiles: readonly McpProfile[] = resolveMcpProfiles(),
): Record<string, unknown> {
  const exposedTools = getMcpProfileToolNames(BRIDGE_TOOLS, profiles) as Set<string>;
  const definitionsByName = new Map<string, { description: string }>(
    TOOL_DEFINITIONS.map((definition) => [definition.name, { description: definition.description }]),
  );

  return {
    schemaVersion: "control-deck.mcp.tool-manifest.v1",
    activeProfiles: profiles,
    profileSummary: mcpProfileSummary(profiles),
    generatedAt: new Date().toISOString(),
    tools: Array.from(exposedTools).sort().map((name) => {
      const manifest = getManifest(name);
      const definition = definitionsByName.get(name);
      return {
        name,
        description: definition?.description ?? `Control Deck bridge tool ${name}`,
        risk: manifest.risk,
        sideEffect: manifest.sideEffect,
        requiresApproval: manifest.requiresApproval,
        allowInVoice: manifest.allowInVoice,
        allowInMcp: manifest.allowInMcp,
        timeoutMs: manifest.timeoutMs,
      };
    }),
  };
}

export function buildPlatformCapabilitiesResource(opts: {
  deckUrl?: string;
  workspaceUrl?: string;
  bridgeUrl?: string;
} = {}): Record<string, unknown> {
  return {
    schemaVersion: "control-deck.mcp.platform-capabilities.v1",
    generatedAt: new Date().toISOString(),
    runtime: {
      nodePlatform: process.platform,
      nodeArch: process.arch,
    },
    urls: {
      deck: opts.deckUrl ?? "http://localhost:3333/deck",
      workspace: opts.workspaceUrl ?? "http://localhost:3333/deck/workspace",
      bridge: opts.bridgeUrl ?? "http://localhost:3333/api/tools/bridge",
    },
    workspace: {
      requiresOpenBrowserClient: true,
      preferredObserveTool: "workspace_get_state",
      notOpenErrorCode: "workspace_not_open",
      recovery: [
        "Open http://localhost:3333/deck/workspace",
        "Retry workspace_get_state",
      ],
    },
    nativeAutomation: {
      linux: {
        readTools: ["native_locate", "native_tree", "native_screen_grab"],
        writeTools: ["native_focus_window", "native_focus", "native_click", "native_type", "native_key", "native_click_pixel"],
        note: "Use accessibility handles first; pixel click is last resort and requires visual verification.",
      },
      windowsOnlyTools: [
        "native_invoke",
        "native_wait_for",
        "native_element_from_point",
        "native_read_text",
        "native_with_cache",
        "native_watch_install",
        "native_watch_drain",
        "native_watch_remove",
        "native_baseline_capture",
        "native_baseline_restore",
      ],
    },
  };
}

async function readWorkspaceStateFromBridge(
  bridgeUrl: string | undefined,
  profiles: readonly McpProfile[],
): Promise<unknown> {
  if (!bridgeUrl) {
    return {
      success: false,
      error_code: "bridge_url_missing",
      message: "No Control Deck tool bridge URL was configured for this MCP resource.",
      recovery: ["Configure CONTROL_DECK_TOOL_BRIDGE_URL or use the stdio wrapper default."],
      safe_to_retry: false,
    };
  }

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const result = await callToolBridgeHttp({
    bridgeUrl,
    tool: "workspace_get_state",
    args: { includeLayout: false },
    threadId: "mcp:resource:workspace-state",
    runId: `mcp-resource-${suffix}`,
    toolCallId: `mcp-resource-call-${suffix}`,
    policyCtx: {
      source: "mcp",
      modality: "mcp",
      mcpProfiles: [...profiles],
    },
  });

  if (result.success) {
    return result.data ?? { success: true, message: result.message ?? "workspace_get_state succeeded" };
  }

  return {
    success: false,
    message: result.message ?? result.error ?? "workspace_get_state failed",
    error: result.error,
    error_code: result.error_code,
    recovery: result.recovery,
    safe_to_retry: result.safe_to_retry,
    issues: result.issues,
  };
}

function markdownResource(uri: URL, text: string): ReadResourceResult {
  return {
    contents: [
      {
        uri: uri.toString(),
        mimeType: "text/markdown",
        text,
      },
    ],
  };
}

function jsonResource(uri: URL, value: unknown): ReadResourceResult {
  return {
    contents: [
      {
        uri: uri.toString(),
        mimeType: "application/json",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}
