import { BRIDGE_TOOLS } from "./bridgeToolList";

export const MCP_PROFILE_NAMES = [
  "core",
  "knowledge",
  "creative",
  "desktop-read",
  "desktop-control",
  "developer",
  "full",
] as const;

export type McpProfile = (typeof MCP_PROFILE_NAMES)[number];

export const DEFAULT_MCP_PROFILE: McpProfile = "core";

const PROFILE_TOOLS: Record<Exclude<McpProfile, "full">, readonly string[]> = {
  core: [
    "workspace_get_state",
    "workspace_list_panes",
    "workspace_open_pane",
    "workspace_focus_pane",
    "workspace_pane_call",
    "workspace_write_note",
    "workspace_show_canvas",
    "vector_search",
    "analyze_image",
    "glyph_motif",
  ],
  knowledge: ["vector_store", "vector_ingest"],
  creative: [
    "generate_image",
    "edit_image",
    "generate_audio",
    "image_to_3d",
    "comfy_workflow_list",
    "comfy_workflow_get",
    "comfy_workflow_run",
  ],
  "desktop-read": [
    "native_locate",
    "native_tree",
    "native_screen_grab",
    "native_read_text",
    "native_element_from_point",
    "native_with_cache",
    "native_wait_for",
    "native_capabilities",
  ],
  "desktop-control": [
    "native_focus",
    "native_focus_window",
    "native_click",
    "native_type",
    "native_key",
    "native_click_pixel",
    "native_invoke",
    "native_watch_install",
    "native_watch_drain",
    "native_watch_remove",
    "native_baseline_capture",
    "native_baseline_restore",
  ],
  developer: ["execute_code", "workspace_close_pane", "workspace_reset"],
};

const UNSAFE_PANE_PROFILE_SET = new Set<McpProfile>([
  "developer",
  "desktop-control",
  "full",
]);

// Capability names are pane-local today (e.g. "load_code") but some prompts
// and future adapters use namespaced forms (e.g. "canvas.load_code"). Accept
// both so the policy does not become brittle while still blocking terminal I/O.
const SAFE_CORE_PANE_CAPABILITIES = new Set<string>([
  "chat.append_text",
  "append_text",
  "notes.read_text",
  "read_text",
  "notes.append_text",
  "notes.replace_text",
  "replace_text",
  "canvas.load_code",
  "load_code",
  "canvas.load_preview",
  "load_preview",
  "canvas.load_artifact",
  "load_artifact",
  "browser.navigate",
  "navigate",
]);

export function isMcpProfile(value: string): value is McpProfile {
  return (MCP_PROFILE_NAMES as readonly string[]).includes(value);
}

export function parseMcpProfiles(raw: string | null | undefined): McpProfile[] {
  const values = (raw ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const profiles = values.filter(isMcpProfile);
  if (profiles.length === 0) return [DEFAULT_MCP_PROFILE];

  const unique: McpProfile[] = [];
  for (const profile of profiles) {
    if (!unique.includes(profile)) unique.push(profile);
  }
  return unique;
}

export function resolveMcpProfiles(
  env?: Partial<Record<"CONTROL_DECK_MCP_EXPOSE" | "CONTROL_DECK_MCP_PROFILE", string | undefined>>,
): McpProfile[] {
  const source = env ?? (process.env as Record<string, string | undefined>);
  if (source.CONTROL_DECK_MCP_EXPOSE) return parseMcpProfiles(source.CONTROL_DECK_MCP_EXPOSE);
  return parseMcpProfiles(source.CONTROL_DECK_MCP_PROFILE);
}

export function getMcpProfileToolNames(
  allBridgeTools: Iterable<string> = BRIDGE_TOOLS,
  profiles: readonly McpProfile[] = resolveMcpProfiles(),
): Set<string> {
  const all = new Set(allBridgeTools);
  if (profiles.includes("full")) return all;

  const out = new Set<string>();
  const add = (profile: Exclude<McpProfile, "full">) => {
    for (const tool of PROFILE_TOOLS[profile]) {
      if (all.has(tool)) out.add(tool);
    }
  };

  // Non-full profiles are additive, but every non-full external agent gets the
  // cockpit basics. This keeps CONTROL_DECK_MCP_PROFILE=developer from losing
  // workspace observation, which makes Qwen-style small models much worse.
  add("core");
  for (const profile of profiles) {
    if (profile === "full" || profile === "core") continue;
    if (profile === "desktop-control") add("desktop-read");
    add(profile);
  }
  return out;
}

export function isToolExposedForMcpProfile(
  tool: string,
  profiles: readonly McpProfile[] = resolveMcpProfiles(),
  allBridgeTools: Iterable<string> = BRIDGE_TOOLS,
): boolean {
  return getMcpProfileToolNames(allBridgeTools, profiles).has(tool);
}

export function profileAllowsUnsafePaneCapabilities(
  profiles: readonly McpProfile[] = resolveMcpProfiles(),
): boolean {
  return profiles.some((profile) => UNSAFE_PANE_PROFILE_SET.has(profile));
}

export function isSafeCorePaneCapability(capability: unknown): boolean {
  return typeof capability === "string" && SAFE_CORE_PANE_CAPABILITIES.has(capability);
}

export function mcpProfileSummary(
  profiles: readonly McpProfile[] = resolveMcpProfiles(),
): string {
  return profiles.join(",");
}
