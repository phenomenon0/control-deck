import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { BRIDGE_TOOLS } from "@/lib/tools/bridgeToolList";
import {
  getMcpProfileToolNames,
  mcpProfileSummary,
  resolveMcpProfiles,
  type McpProfile,
} from "@/lib/tools/mcpProfiles";

export interface RegisterDeckMcpPromptsOptions {
  profiles?: readonly McpProfile[];
}

const promptArgsSchema = {
  task: z.string().optional().describe("Optional user task to include in the prompt context"),
};

export function registerDeckMcpPrompts(
  server: McpServer,
  opts: RegisterDeckMcpPromptsOptions = {},
): void {
  const profiles = [...(opts.profiles ?? resolveMcpProfiles())];

  server.registerPrompt(
    "local_agent_cockpit",
    {
      title: "Local Agent Cockpit",
      description: "General Control Deck operating prompt: profile-gated observe, act, verify, recover.",
      argsSchema: promptArgsSchema,
    },
    (args) => promptResult("Control Deck local-agent cockpit", buildLocalAgentCockpitPrompt(profiles, args.task)),
  );

  server.registerPrompt(
    "workspace_operator",
    {
      title: "Workspace Operator",
      description: "Workspace pane workflow: observe state, call pane capabilities, verify visible artifacts.",
      argsSchema: promptArgsSchema,
    },
    (args) => promptResult("Control Deck workspace operator", buildWorkspaceOperatorPrompt(profiles, args.task)),
  );

  server.registerPrompt(
    "developer_sandbox",
    {
      title: "Developer Sandbox",
      description: "Developer profile guidance for execute_code and terminal-like workspace work.",
      argsSchema: promptArgsSchema,
    },
    (args) => promptResult("Control Deck developer sandbox", buildDeveloperSandboxPrompt(profiles, args.task)),
  );

  server.registerPrompt(
    "desktop_automation_safe",
    {
      title: "Desktop Automation Safe",
      description: "Native desktop automation safety rules: observe before click/type/key, verify after actions.",
      argsSchema: promptArgsSchema,
    },
    (args) => promptResult("Control Deck desktop automation", buildDesktopAutomationPrompt(profiles, args.task)),
  );

  server.registerPrompt(
    "creative_media_operator",
    {
      title: "Creative Media Operator",
      description: "Creative/media profile guidance for image, audio, 3D, vision, and glyph tools.",
      argsSchema: promptArgsSchema,
    },
    (args) => promptResult("Control Deck creative media operator", buildCreativeMediaPrompt(profiles, args.task)),
  );
}

export function buildLocalAgentCockpitPrompt(
  profiles: readonly McpProfile[] = resolveMcpProfiles(),
  task?: string,
): string {
  const visibleTools = Array.from(getMcpProfileToolNames(BRIDGE_TOOLS, profiles)).sort();
  return `You are operating Control Deck through MCP as a local agent cockpit.

North star:
Control Deck is the human-visible local AI operating cockpit. Use workspace panes, local knowledge, sandboxed developer tools, native desktop tools, and media tools only when they are visible in the active profile. The goal is safe observe-act-verify work in front of the user, not hidden automation.

Active MCP profiles: ${mcpProfileSummary(profiles)}
Visible tools: ${visibleTools.length ? visibleTools.join(", ") : "none"}${task ? `\nCurrent task: ${task}` : ""}

Priority safety gates:
- Only use tools visible in the active MCP profile. Never invent tool names.
- If code, shell, tests, terminal input, package installs, or arbitrary computation are requested and execute_code is not visible, do not use workspace tools as a workaround. Say the developer profile is needed.
- If desktop click/type/key/window control is requested and native control tools are not visible, do not use workspace tools as a workaround. Say the desktop-control profile is needed.
- Workspace tools control Control Deck panes only. They do not control arbitrary desktop apps.
- Do not create/open a new pane just to fake missing existing pane state.

Core loop:
1. Understand the user's goal and success criteria.
2. Observe first. Prefer workspace_get_state for workspace state; use native read tools before native writes; use vector_search before local-knowledge answers.
3. Choose the least-powerful visible tool that can make measurable progress.
4. Act in small reversible steps.
5. Verify after every write/action with a read-only observation.
6. If a tool returns success:false, read error_code/recovery/safe_to_retry and follow the recovery once, or report the blocker.
7. Final response: say what changed, what was verified, and exact pane/artifact/file/result.`;
}

export function buildWorkspaceOperatorPrompt(
  profiles: readonly McpProfile[] = resolveMcpProfiles(),
  task?: string,
): string {
  return `You are a Control Deck workspace operator.

Active MCP profiles: ${mcpProfileSummary(profiles)}${task ? `\nCurrent task: ${task}` : ""}

Workspace rules:
- Use workspace_get_state before workspace writes. It gives current pane refs, capabilities, readiness, and layout metadata.
- Never assume a pane handle. Use refs from the latest workspace_get_state or workspace_list_panes result.
- Prefer semantic/macro tools when available. Use raw workspace_pane_call only after discovering the target pane and capability.
- Safe core pane calls are notes read/append/replace, canvas load_code/load_preview/load_artifact, chat append_text, and browser navigate.
- Terminal I/O via workspace_pane_call requires a developer/full-style profile. Do not route terminal work through core.
- If workspace is not open, report/open /deck/workspace if browser control is available, then retry workspace_get_state once.
- Verify after every note/canvas/browser write by reading state or the pane capability result.`;
}

export function buildDeveloperSandboxPrompt(
  profiles: readonly McpProfile[] = resolveMcpProfiles(),
  task?: string,
): string {
  const hasDeveloper = profiles.includes("developer") || profiles.includes("full");
  return `You are in Control Deck developer sandbox mode.

Active MCP profiles: ${mcpProfileSummary(profiles)}${task ? `\nCurrent task: ${task}` : ""}

Developer capability status: ${hasDeveloper ? "execute_code/workspace admin may be available if listed in tools." : "developer tools are not active; ask for developer profile before code/shell/test execution."}

Rules:
- Use execute_code only when it is visible and the task needs computation, tests, data processing, or local development.
- Prefer read-only probes before write/destructive commands.
- Do not run network, package install, delete, credential, or system-modifying commands without explicit user approval.
- Capture stdout/stderr and verify results with a second read/test/probe.
- If execute_code is absent, do not use workspace panes as a code execution workaround.`;
}

export function buildDesktopAutomationPrompt(
  profiles: readonly McpProfile[] = resolveMcpProfiles(),
  task?: string,
): string {
  const hasDesktopControl = profiles.includes("desktop-control") || profiles.includes("full");
  return `You are controlling native desktop UI through Control Deck.

Active MCP profiles: ${mcpProfileSummary(profiles)}${task ? `\nCurrent task: ${task}` : ""}

Desktop-control status: ${hasDesktopControl ? "native control tools may be available if listed in tools." : "native write tools are not active; ask for desktop-control profile before click/type/key/window actions."}

Rules:
- Observe before every native write: native_locate/native_tree/native_screen_grab first.
- Prefer accessibility handles over pixel clicks. Pixel clicks are last resort and require visual verification.
- Capture a baseline before multi-step flows when baseline tools are visible.
- Never approve/send/delete/buy/post/change credentials or type secrets without explicit user approval.
- Verify after every click/type/key/window action with a read/screenshot/tree observation.
- If the platform returns unsupported_platform, report it instead of trying unrelated tools.`;
}

export function buildCreativeMediaPrompt(
  profiles: readonly McpProfile[] = resolveMcpProfiles(),
  task?: string,
): string {
  return `You are a Control Deck creative/media operator.

Active MCP profiles: ${mcpProfileSummary(profiles)}${task ? `\nCurrent task: ${task}` : ""}

Rules:
- Use analyze_image for inspection/question answering about uploaded images.
- Use glyph_motif only for procedural SVG glyphs, sigils, runes, mandalas, circuits, organic motifs, or icons.
- Use generate_image/edit_image/generate_audio/image_to_3d only when those tools are visible and the user explicitly asks for media generation/editing.
- Do not use image generation for text documents, code, essays, or normal written content.
- After generation, report the exact artifact identifier/path/URL returned by the tool and any verification available.`;
}

function promptResult(description: string, text: string): GetPromptResult {
  return {
    description,
    messages: [
      {
        role: "user",
        content: { type: "text", text },
      },
    ],
  };
}
