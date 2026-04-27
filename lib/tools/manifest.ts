/**
 * Tool manifest — risk + side-effect metadata for every bridge tool.
 *
 * The deck's policy decisions (preflight, voice, MCP, approvals) all
 * read from this single table. Splitting it out from `definitions.ts`
 * keeps the schema file focused on Zod shapes the LLM sees, while this
 * file holds the runtime policy facts the *deck* decides on.
 *
 * Risk levels (informally):
 *   read_only      — pure observation; no side effects.
 *   low_write      — UI/state mutation, easy to reverse.
 *   medium_write   — local artifact creation, workspace edits.
 *   high_write     — external/permanent: send/persist outside the deck.
 *   sensitive      — credentials/locks/security-relevant.
 *   dangerous      — arbitrary code, deletes, or shell.
 *
 * Side-effect categories track *what* changes, not how risky it is —
 * helps when reasoning about reversal, audit logs, voice-mode caps.
 */

export type RiskLevel =
  | "read_only"
  | "low_write"
  | "medium_write"
  | "high_write"
  | "sensitive"
  | "dangerous";

export type SideEffectKind =
  | "none"
  | "reversible"
  | "persistent"
  | "external"
  | "destructive"
  | "security_sensitive";

export interface ToolManifestEntry {
  name: string;
  risk: RiskLevel;
  sideEffect: SideEffectKind;
  /** May be invoked from a voice modality. Defaults derived from risk. */
  allowInVoice: boolean;
  /** May be exposed via the deck's MCP server. */
  allowInMcp: boolean;
  /** Always require an approval prompt before execution. */
  requiresApproval: boolean;
  /** Soft execution timeout used by the bridge dispatcher. */
  timeoutMs: number;
  /** Map noisy or sensitive args to a redacted shape for log/event payloads. */
  redactForLog?: (args: Record<string, unknown>) => Record<string, unknown>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const LONG_TIMEOUT_MS = 120_000;

/**
 * Per-tool entries. Anything not listed defaults to `medium_write` +
 * approval-required so unknown tools fail safe.
 *
 * Ordering reflects the bridge allowlist in `bridgeDispatch.ts`.
 */
export const TOOL_MANIFEST: Record<string, ToolManifestEntry> = {
  // ── Media generation (external GPU calls; reversible only at a workspace level)
  generate_image: {
    name: "generate_image",
    risk: "medium_write",
    sideEffect: "persistent",
    allowInVoice: true,
    allowInMcp: true,
    requiresApproval: false,
    timeoutMs: LONG_TIMEOUT_MS,
  },
  edit_image: {
    name: "edit_image",
    risk: "medium_write",
    sideEffect: "persistent",
    allowInVoice: true,
    allowInMcp: true,
    requiresApproval: false,
    timeoutMs: LONG_TIMEOUT_MS,
  },
  generate_audio: {
    name: "generate_audio",
    risk: "medium_write",
    sideEffect: "persistent",
    allowInVoice: true,
    allowInMcp: true,
    requiresApproval: false,
    timeoutMs: LONG_TIMEOUT_MS,
  },
  image_to_3d: {
    name: "image_to_3d",
    risk: "medium_write",
    sideEffect: "persistent",
    allowInVoice: true,
    allowInMcp: true,
    requiresApproval: false,
    timeoutMs: LONG_TIMEOUT_MS,
  },
  analyze_image: {
    name: "analyze_image",
    risk: "read_only",
    sideEffect: "none",
    allowInVoice: true,
    allowInMcp: true,
    requiresApproval: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  },
  glyph_motif: {
    name: "glyph_motif",
    risk: "low_write",
    sideEffect: "reversible",
    allowInVoice: true,
    allowInMcp: true,
    requiresApproval: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  },
  execute_code: {
    name: "execute_code",
    risk: "dangerous",
    sideEffect: "destructive",
    allowInVoice: false,
    allowInMcp: false,
    requiresApproval: true,
    timeoutMs: LONG_TIMEOUT_MS,
  },
  vector_search: {
    name: "vector_search",
    risk: "read_only",
    sideEffect: "none",
    allowInVoice: true,
    allowInMcp: true,
    requiresApproval: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  },
  vector_store: {
    name: "vector_store",
    risk: "medium_write",
    sideEffect: "persistent",
    allowInVoice: true,
    allowInMcp: true,
    requiresApproval: true,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  },
  vector_ingest: {
    name: "vector_ingest",
    risk: "medium_write",
    sideEffect: "persistent",
    allowInVoice: false,
    allowInMcp: true,
    requiresApproval: true,
    timeoutMs: LONG_TIMEOUT_MS,
  },

  // ── Native automation (mouse / keyboard / window) — destructive surface for voice
  native_locate:          mkNativeRead(),
  native_tree:            mkNativeRead(),
  native_screen_grab:     mkNativeRead(),
  native_read_text:       mkNativeRead(),
  native_element_from_point: mkNativeRead(),
  native_with_cache:      mkNativeRead(),
  native_wait_for:        mkNativeRead(),

  native_click:           mkNativeWrite(true),
  native_click_pixel:     mkNativeWrite(true),
  native_type:            mkNativeWrite(true),
  native_key:             mkNativeWrite(true),
  native_focus:           mkNativeWrite(false),
  native_focus_window:    mkNativeWrite(false),
  native_invoke:          mkNativeWrite(true),
  native_watch_install:   mkNativeWrite(false),
  native_watch_drain:     mkNativeWrite(false),
  native_watch_remove:    mkNativeWrite(false),
  native_baseline_capture: mkNativeWrite(false),
  native_baseline_restore: mkNativeWrite(true),

  // ── Workspace pane management — reversible UI state
  workspace_open_pane:    mkWorkspace("low_write"),
  workspace_close_pane:   mkWorkspace("low_write"),
  workspace_focus_pane:   mkWorkspace("low_write"),
  workspace_reset:        mkWorkspace("medium_write"),
  workspace_list_panes:   { ...mkWorkspace("low_write"), risk: "read_only", sideEffect: "none" },
  workspace_pane_call:    mkWorkspace("medium_write"),
};

function mkNativeRead(): ToolManifestEntry {
  return {
    name: "native_*",
    risk: "read_only",
    sideEffect: "none",
    allowInVoice: true,
    allowInMcp: true,
    requiresApproval: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
}

function mkNativeWrite(approval: boolean): ToolManifestEntry {
  return {
    name: "native_*",
    risk: "high_write",
    sideEffect: "external",
    allowInVoice: false,
    allowInMcp: false,
    requiresApproval: approval,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
}

function mkWorkspace(risk: RiskLevel): ToolManifestEntry {
  return {
    name: "workspace_*",
    risk,
    sideEffect: "reversible",
    allowInVoice: true,
    allowInMcp: true,
    requiresApproval: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
}

/**
 * Default for any tool not in the manifest. Chosen to fail safe: anything
 * unknown is medium-write + approval-required.
 */
export const DEFAULT_MANIFEST_ENTRY: ToolManifestEntry = {
  name: "_default",
  risk: "medium_write",
  sideEffect: "persistent",
  allowInVoice: false,
  allowInMcp: false,
  requiresApproval: true,
  timeoutMs: DEFAULT_TIMEOUT_MS,
};

export function getManifest(toolName: string): ToolManifestEntry {
  const entry = TOOL_MANIFEST[toolName];
  if (entry) return { ...entry, name: toolName };
  return { ...DEFAULT_MANIFEST_ENTRY, name: toolName };
}

/** Whether the tool has an explicit manifest entry (vs falling back to default). */
export function hasManifestEntry(toolName: string): boolean {
  return Object.prototype.hasOwnProperty.call(TOOL_MANIFEST, toolName);
}

/**
 * Stable hash of the manifest for catalog versioning. Sensitive only to
 * the externally-visible policy facts (risk/sideEffect/allowInVoice/...) —
 * runtime `redactForLog` functions are excluded so swapping the redactor
 * implementation doesn't churn the version.
 */
export function manifestVersion(): string {
  const projection: Record<string, unknown> = {};
  for (const [name, m] of Object.entries(TOOL_MANIFEST)) {
    projection[name] = {
      risk: m.risk,
      sideEffect: m.sideEffect,
      allowInVoice: m.allowInVoice,
      allowInMcp: m.allowInMcp,
      requiresApproval: m.requiresApproval,
      timeoutMs: m.timeoutMs,
    };
  }
  return fnv1a(JSON.stringify(projection));
}

/** 32-bit FNV-1a — small, deterministic, dependency-free. */
function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
