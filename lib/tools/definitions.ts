/**
 * Tool Definitions - Pydantic-style typed schemas using Zod
 * All tools available to the LLM are defined here with full validation
 */

import { z } from "zod";

/**
 * Edit an image using natural language instructions (Qwen Image Edit)
 */
export const EditImageSchema = z.object({
  name: z.literal("edit_image"),
  args: z.object({
    image_id: z.string().describe("Upload ID of the image to edit"),
    instruction: z.string().min(1).describe("Natural language edit instruction"),
    seed: z.number().int().optional().describe("Random seed for reproducibility"),
  }),
});

/**
 * Generate audio/music from text (Stable Audio)
 */
export const GenerateAudioSchema = z.object({
  name: z.literal("generate_audio"),
  args: z.object({
    prompt: z.string().min(1).describe("Description of audio to generate"),
    duration: z.number().min(1).max(47).default(10).describe("Duration in seconds (max 47)"),
    seed: z.number().int().optional().describe("Random seed for reproducibility"),
  }),
});

/**
 * Convert an image to a 3D model (Hunyuan 3D)
 */
export const ImageTo3DSchema = z.object({
  name: z.literal("image_to_3d"),
  args: z.object({
    image_id: z.string().describe("Upload ID of the input image"),
    seed: z.number().int().optional().describe("Random seed for reproducibility"),
  }),
});

/**
 * Generate an image from text (SDXL Turbo - fast)
 */
export const GenerateImageSchema = z.object({
  name: z.literal("generate_image"),
  args: z.object({
    prompt: z.string().min(1).describe("Description of the image to generate"),
    width: z.number().int().min(512).max(1024).default(768).describe("Image width (default 768)"),
    height: z.number().int().min(512).max(1024).default(768).describe("Image height (default 768)"),
    seed: z.number().int().optional().describe("Random seed for reproducibility"),
  }),
});

/**
 * Analyze an image and answer questions (Vision model)
 */
export const AnalyzeImageSchema = z.object({
  name: z.literal("analyze_image"),
  args: z.object({
    image_id: z.string().describe("Upload ID of the image to analyze"),
    question: z.string().optional().describe("Specific question about the image"),
  }),
});

/**
 * Search the web for current information
 */
export const WebSearchSchema = z.object({
  name: z.literal("web_search"),
  args: z.object({
    query: z.string().min(1).describe("Search query"),
    max_results: z.number().int().min(1).max(10).default(5).describe("Maximum results"),
  }),
});

/**
 * Generate a procedural glyph/motif (no GPU required)
 */
export const GlyphMotifSchema = z.object({
  name: z.literal("glyph_motif"),
  args: z.object({
    prompt: z.string().min(1).describe("Theme or concept for the glyph"),
    style: z.enum(["sigil", "rune", "mandala", "circuit", "organic"]).default("sigil").describe("Visual style"),
    size: z.number().int().min(64).max(512).default(256).describe("Image size in pixels"),
    seed: z.number().int().optional().describe("Random seed for reproducibility"),
    sheet: z.boolean().default(false).describe("Generate 4x4 spritesheet of variations"),
  }),
});

/**
 * Execute code in a sandboxed environment with Canvas output
 */
export const ExecuteCodeSchema = z.object({
  name: z.literal("execute_code"),
  args: z.object({
    language: z.enum([
      "python", "lua", "go", "c", "javascript", "typescript", 
      "bash", "sh", "html", "react", "threejs"
    ]).describe("Programming language"),
    code: z.string().min(1).describe("Source code to execute"),
    filename: z.string().optional().describe("Optional filename"),
    args: z.array(z.string()).optional().describe("Command line arguments"),
    stdin: z.string().optional().describe("Standard input"),
    timeout: z.number().int().min(1000).max(60000).default(30000).describe("Timeout in milliseconds"),
  }),
});

/**
 * Search for semantically similar documents in VectorDB
 */
export const VectorSearchSchema = z.object({
  name: z.literal("vector_search"),
  args: z.object({
    query: z.string().min(1).describe("Search query text"),
    collection: z.string().optional().describe("Collection to search in (default: all)"),
    k: z.number().int().min(1).max(100).default(5).describe("Number of results to return"),
    mode: z.enum(["hybrid", "vector", "lexical"]).optional().describe("Search mode: hybrid (best), vector (semantic), or lexical (keyword)"),
    filter: z.record(z.string(), z.string()).optional().describe("Metadata filter - documents must match all key-value pairs"),
  }),
});

/**
 * Store a document in VectorDB for semantic retrieval
 */
export const VectorStoreSchema = z.object({
  name: z.literal("vector_store"),
  args: z.object({
    text: z.string().min(1).describe("Document text to store"),
    collection: z.string().default("default").describe("Collection to store in"),
    metadata: z.record(z.string(), z.string()).optional().describe("Optional metadata key-value pairs"),
  }),
});

/**
 * Ingest content from a URL into VectorDB with automatic chunking
 */
export const VectorIngestSchema = z.object({
  name: z.literal("vector_ingest"),
  args: z.object({
    url: z.string().url().describe("URL to fetch and ingest"),
    collection: z.string().default("default").describe("Collection to store in"),
    metadata: z.record(z.string(), z.string()).optional().describe("Optional metadata key-value pairs"),
  }),
});

const NodeHandleSchema = z.object({
  id: z.string(),
  role: z.string().optional(),
  name: z.string().optional(),
  path: z.string().optional(),
});

export const NativeLocateSchema = z.object({
  name: z.literal("native_locate"),
  args: z.object({
    name: z.string().optional().describe("Accessible name (substring match)"),
    role: z.string().optional().describe("Role filter (e.g. 'button', 'window')"),
    app: z.string().optional().describe("App/process hint"),
    limit: z.number().int().min(1).max(50).default(10).describe("Max results"),
  }),
});

export const NativeClickSchema = z.object({
  name: z.literal("native_click"),
  args: z.object({
    handle: NodeHandleSchema.describe("Handle returned by native_locate"),
  }),
});

export const NativeTypeSchema = z.object({
  name: z.literal("native_type"),
  args: z.object({
    handle: NodeHandleSchema.nullable().optional().describe("Target handle; null for focused element"),
    text: z.string().min(1).describe("Text to type"),
  }),
});

export const NativeTreeSchema = z.object({
  name: z.literal("native_tree"),
  args: z.object({
    handle: NodeHandleSchema.optional().describe("Root handle; omit for desktop root"),
  }),
});

export const NativeKeySchema = z.object({
  name: z.literal("native_key"),
  args: z.object({
    key: z
      .string()
      .min(1)
      .describe(
        "Key or combo: single character, keysym name ('Return', 'F10'), or '+'-joined combo ('Ctrl+l', 'Alt+F10')",
      ),
  }),
});

export const NativeFocusSchema = z.object({
  name: z.literal("native_focus"),
  args: z.object({
    handle: NodeHandleSchema.describe("Handle to grab focus on"),
  }),
});

export const NativeScreenGrabSchema = z.object({
  name: z.literal("native_screen_grab"),
  args: z.object({}).describe("No args — captures the full desktop as PNG"),
});

export const NativeFocusWindowSchema = z.object({
  name: z.literal("native_focus_window"),
  args: z.object({
    app_id: z
      .string()
      .min(1)
      .describe(
        "Desktop app-id without the .desktop suffix (e.g. 'org.telegram.desktop', 'firefox', 'org.gnome.Nautilus')",
      ),
  }),
});

export const NativeClickPixelSchema = z.object({
  name: z.literal("native_click_pixel"),
  args: z.object({
    x: z.number().int().min(0).describe("Absolute desktop X pixel coordinate"),
    y: z.number().int().min(0).describe("Absolute desktop Y pixel coordinate"),
    button: z
      .enum(["left", "right", "middle"])
      .default("left")
      .describe("Mouse button to click"),
  }),
});

// Windows-only extras (return unsupported_platform elsewhere). Grouped
// together so they're easy to spot during cross-platform work.

const UiaPatternEnum = z.enum([
  "Invoke",
  "Toggle",
  "ExpandCollapse",
  "Scroll",
  "ScrollItem",
  "RangeValue",
  "Value",
  "Selection",
  "SelectionItem",
  "Window",
]);

export const NativeInvokeSchema = z.object({
  name: z.literal("native_invoke"),
  args: z.object({
    handle: NodeHandleSchema.describe("Handle from native_locate"),
    pattern: UiaPatternEnum.describe("UIA control pattern"),
    action: z.string().min(1).describe("Pattern action (e.g. 'Invoke', 'SetValue', 'Expand')"),
    params: z.record(z.string(), z.unknown()).optional().describe("Pattern-specific params (e.g. { value: 42 })"),
  }),
});

export const NativeWaitForSchema = z.object({
  name: z.literal("native_wait_for"),
  args: z.object({
    event: z
      .enum(["structure_changed", "focus_changed", "property_changed"])
      .describe("UIA event type to wait for"),
    handle: NodeHandleSchema.optional().describe("Anchor handle; defaults to desktop root"),
    match: z
      .object({
        name: z.string().optional(),
        role: z.string().optional(),
        automationId: z.string().optional(),
        property: z.string().optional().describe("For property_changed: property name (Name, IsEnabled, ...)"),
      })
      .optional()
      .describe("Predicate applied to the event's element"),
    timeoutMs: z.number().int().min(100).max(60_000).optional().describe("Timeout in ms (default 30000)"),
  }),
});

export const NativeElementFromPointSchema = z.object({
  name: z.literal("native_element_from_point"),
  args: z.object({
    x: z.number().int().describe("Absolute desktop X pixel"),
    y: z.number().int().describe("Absolute desktop Y pixel"),
  }),
});

export const NativeReadTextSchema = z.object({
  name: z.literal("native_read_text"),
  args: z.object({
    handle: NodeHandleSchema.describe("Handle of a TextPattern-supporting element"),
    range: z
      .object({
        start: z.number().int().min(0),
        end: z.number().int().min(0),
      })
      .optional()
      .describe("Optional character offsets; omit for the full text"),
  }),
});

export const NativeWithCacheSchema = z.object({
  name: z.literal("native_with_cache"),
  args: z.object({
    handle: NodeHandleSchema.optional().describe("Subtree anchor; defaults to desktop"),
    depth: z.number().int().min(1).max(50).optional().describe("Cache depth"),
    ops: z
      .array(
        z.discriminatedUnion("op", [
          z.object({
            op: z.literal("locate"),
            query: z.object({
              name: z.string().optional(),
              role: z.string().optional(),
              app: z.string().optional(),
              limit: z.number().int().min(1).max(50).optional(),
            }),
          }),
          z.object({ op: z.literal("tree") }),
          z.object({ op: z.literal("read_text"), handle: NodeHandleSchema }),
        ]),
      )
      .min(1)
      .describe("Sub-ops to run against the cached subtree"),
  }),
});

// Robust-automation primitives — see docs/native-adapter/windows.md.

export const NativeWatchInstallSchema = z.object({
  name: z.literal("native_watch_install"),
  args: z.object({
    match: z
      .object({
        name: z.string().optional(),
        role: z.string().optional(),
        automationId: z.string().optional(),
        app: z.string().optional(),
      })
      .describe("Predicate applied to every new window/dialog/popup"),
    action: z
      .enum(["notify", "dismiss_via_escape", "invoke_button"])
      .default("notify")
      .describe("What the host does when a match appears. 'notify' never auto-clicks; 'invoke_button' requires buttonName and should NOT be used for consent-critical prompts (UAC, save-changes, password)."),
    buttonName: z
      .string()
      .optional()
      .describe("Required for action=invoke_button. Substring matched against descendant button names."),
    scope: z
      .enum(["desktop", "app"])
      .default("desktop")
      .describe("'desktop' watches everywhere; 'app' limits to the foreground app subtree."),
    ttlMs: z
      .number()
      .int()
      .min(1_000)
      .max(1_800_000)
      .optional()
      .describe("TTL in ms. Default 300000 (5 min), cap 1800000 (30 min)."),
  }),
});

export const NativeWatchDrainSchema = z.object({
  name: z.literal("native_watch_drain"),
  args: z.object({
    watchId: z.string().optional().describe("Specific watcher to drain; omit for all."),
  }),
});

export const NativeWatchRemoveSchema = z.object({
  name: z.literal("native_watch_remove"),
  args: z.object({
    watchId: z.string().describe("Watcher id returned by native_watch_install"),
  }),
});

export const NativeBaselineCaptureSchema = z.object({
  name: z.literal("native_baseline_capture"),
  args: z.object({
    label: z.string().optional().describe("Optional human-readable label for debugging"),
  }),
});

export const NativeBaselineRestoreSchema = z.object({
  name: z.literal("native_baseline_restore"),
  args: z.object({
    baselineId: z.string().describe("Id from native_baseline_capture"),
    strategy: z
      .enum(["close_modals", "close_modals_then_focus"])
      .default("close_modals")
      .describe("'close_modals' closes all windows not in the baseline; 'close_modals_then_focus' also re-focuses the baseline's app."),
  }),
});

// ── Workspace tools ─────────────────────────────────────────────────
// Relayed through /api/workspace/commands SSE — fire-and-forget so the
// agent can rearrange the pane layout without synchronous responses.

const WORKSPACE_PANE_TYPES = [
  "chat", "terminal", "canvas", "browser", "notes",
  "agentgo", "audio", "comfy", "control", "models", "runs", "tools", "voice",
] as const;

export const WorkspaceOpenPaneSchema = z.object({
  name: z.literal("workspace_open_pane"),
  args: z.object({
    type: z.enum(WORKSPACE_PANE_TYPES).describe("Pane component key"),
    title: z.string().optional().describe("Tab title; defaults to the type name"),
    position: z
      .enum(["left", "right", "above", "below"])
      .optional()
      .describe("Split direction relative to current active pane; omit to add as tab"),
    referencePane: z
      .string()
      .optional()
      .describe("Pane id to position relative to; omit to use the focused group"),
  }),
});

export const WorkspaceClosePaneSchema = z.object({
  name: z.literal("workspace_close_pane"),
  args: z.object({
    paneId: z.string().describe("Pane handle id — format '<type>:<instanceId>', or the Dockview panel id"),
  }),
});

export const WorkspaceFocusPaneSchema = z.object({
  name: z.literal("workspace_focus_pane"),
  args: z.object({
    paneId: z.string().describe("Pane id to focus"),
  }),
});

export const WorkspaceResetSchema = z.object({
  name: z.literal("workspace_reset"),
  args: z.object({}).describe("Reset the workspace to the default layout"),
});

export const WorkspaceListPanesSchema = z.object({
  name: z.literal("workspace_list_panes"),
  args: z.object({}).describe("Snapshot of every registered pane + its capabilities + topic rates"),
});

export const WorkspacePaneCallSchema = z.object({
  name: z.literal("workspace_pane_call"),
  args: z.object({
    target: z.string().describe("Pane handle id, e.g. 'terminal:terminal-default'"),
    capability: z.string().describe("Capability name to invoke (see workspace_list_panes output)"),
    args: z.record(z.string(), z.unknown()).optional().describe("Payload passed to the capability handler"),
  }),
});

export const ToolCallSchema = z.discriminatedUnion("name", [
  EditImageSchema,
  GenerateAudioSchema,
  ImageTo3DSchema,
  GenerateImageSchema,
  AnalyzeImageSchema,
  WebSearchSchema,
  GlyphMotifSchema,
  ExecuteCodeSchema,
  VectorSearchSchema,
  VectorStoreSchema,
  VectorIngestSchema,
  NativeLocateSchema,
  NativeClickSchema,
  NativeTypeSchema,
  NativeTreeSchema,
  NativeKeySchema,
  NativeFocusSchema,
  NativeScreenGrabSchema,
  NativeFocusWindowSchema,
  NativeClickPixelSchema,
  NativeInvokeSchema,
  NativeWaitForSchema,
  NativeElementFromPointSchema,
  NativeReadTextSchema,
  NativeWithCacheSchema,
  NativeWatchInstallSchema,
  NativeWatchDrainSchema,
  NativeWatchRemoveSchema,
  NativeBaselineCaptureSchema,
  NativeBaselineRestoreSchema,
  WorkspaceOpenPaneSchema,
  WorkspaceClosePaneSchema,
  WorkspaceFocusPaneSchema,
  WorkspaceResetSchema,
  WorkspaceListPanesSchema,
  WorkspacePaneCallSchema,
]);

export type ToolCall = z.infer<typeof ToolCallSchema>;
export type ToolName = ToolCall["name"];

/**
 * Per-tool args schemas keyed by ToolName.
 * Used by the bridge route for runtime input validation.
 * Only the `args` sub-schema is stored; the tool name is already known from the key.
 */
export const TOOL_SCHEMAS: Partial<Record<ToolName, z.ZodType>> = {
  edit_image:            EditImageSchema.shape.args,
  generate_audio:        GenerateAudioSchema.shape.args,
  image_to_3d:           ImageTo3DSchema.shape.args,
  generate_image:        GenerateImageSchema.shape.args,
  analyze_image:         AnalyzeImageSchema.shape.args,
  web_search:            WebSearchSchema.shape.args,
  glyph_motif:           GlyphMotifSchema.shape.args,
  execute_code:          ExecuteCodeSchema.shape.args,
  vector_search:         VectorSearchSchema.shape.args,
  vector_store:          VectorStoreSchema.shape.args,
  vector_ingest:         VectorIngestSchema.shape.args,
  native_locate:         NativeLocateSchema.shape.args,
  native_click:          NativeClickSchema.shape.args,
  native_type:           NativeTypeSchema.shape.args,
  native_tree:           NativeTreeSchema.shape.args,
  native_key:            NativeKeySchema.shape.args,
  native_focus:          NativeFocusSchema.shape.args,
  native_screen_grab:    NativeScreenGrabSchema.shape.args,
  native_focus_window:   NativeFocusWindowSchema.shape.args,
  native_click_pixel:    NativeClickPixelSchema.shape.args,
};

// Type helpers for individual tools
export type EditImageArgs = z.infer<typeof EditImageSchema>["args"];
export type GenerateAudioArgs = z.infer<typeof GenerateAudioSchema>["args"];
export type ImageTo3DArgs = z.infer<typeof ImageTo3DSchema>["args"];
export type GenerateImageArgs = z.infer<typeof GenerateImageSchema>["args"];
export type AnalyzeImageArgs = z.infer<typeof AnalyzeImageSchema>["args"];
export type WebSearchArgs = z.infer<typeof WebSearchSchema>["args"];
export type GlyphMotifArgs = z.infer<typeof GlyphMotifSchema>["args"];
export type ExecuteCodeArgs = z.infer<typeof ExecuteCodeSchema>["args"];
export type VectorSearchArgs = z.infer<typeof VectorSearchSchema>["args"];
export type VectorStoreArgs = z.infer<typeof VectorStoreSchema>["args"];
export type VectorIngestArgs = z.infer<typeof VectorIngestSchema>["args"];
export type NativeLocateArgs = z.infer<typeof NativeLocateSchema>["args"];
export type NativeClickArgs = z.infer<typeof NativeClickSchema>["args"];
export type NativeTypeArgs = z.infer<typeof NativeTypeSchema>["args"];
export type NativeTreeArgs = z.infer<typeof NativeTreeSchema>["args"];
export type NativeKeyArgs = z.infer<typeof NativeKeySchema>["args"];
export type NativeFocusArgs = z.infer<typeof NativeFocusSchema>["args"];
export type NativeScreenGrabArgs = z.infer<typeof NativeScreenGrabSchema>["args"];
export type NativeFocusWindowArgs = z.infer<typeof NativeFocusWindowSchema>["args"];
export type NativeClickPixelArgs = z.infer<typeof NativeClickPixelSchema>["args"];
export type NativeInvokeArgs = z.infer<typeof NativeInvokeSchema>["args"];
export type NativeWaitForArgs = z.infer<typeof NativeWaitForSchema>["args"];
export type NativeElementFromPointArgs = z.infer<typeof NativeElementFromPointSchema>["args"];
export type NativeReadTextArgs = z.infer<typeof NativeReadTextSchema>["args"];
export type NativeWithCacheArgs = z.infer<typeof NativeWithCacheSchema>["args"];
export type NativeWatchInstallArgs = z.infer<typeof NativeWatchInstallSchema>["args"];
export type NativeWatchDrainArgs = z.infer<typeof NativeWatchDrainSchema>["args"];
export type NativeWatchRemoveArgs = z.infer<typeof NativeWatchRemoveSchema>["args"];
export type NativeBaselineCaptureArgs = z.infer<typeof NativeBaselineCaptureSchema>["args"];
export type NativeBaselineRestoreArgs = z.infer<typeof NativeBaselineRestoreSchema>["args"];
export type WorkspaceOpenPaneArgs = z.infer<typeof WorkspaceOpenPaneSchema>["args"];
export type WorkspaceClosePaneArgs = z.infer<typeof WorkspaceClosePaneSchema>["args"];
export type WorkspaceFocusPaneArgs = z.infer<typeof WorkspaceFocusPaneSchema>["args"];
export type WorkspaceResetArgs = z.infer<typeof WorkspaceResetSchema>["args"];
export type WorkspaceListPanesArgs = z.infer<typeof WorkspaceListPanesSchema>["args"];
export type WorkspacePaneCallArgs = z.infer<typeof WorkspacePaneCallSchema>["args"];

export interface ToolDefinition {
  name: ToolName;
  description: string;
  parameters: Array<{
    name: string;
    type: string;
    required: boolean;
    description: string;
    default?: unknown;
  }>;
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "edit_image",
    description: "Edit an image using natural language instructions with Qwen AI",
    parameters: [
      { name: "image_id", type: "string", required: true, description: "Upload ID of the image to edit" },
      { name: "instruction", type: "string", required: true, description: "What to change (e.g., 'make the sky sunset colors', 'remove the car')" },
      { name: "seed", type: "number", required: false, description: "Random seed for reproducibility" },
    ],
  },
  {
    name: "generate_audio",
    description: "Generate music or audio from a text description using Stable Audio",
    parameters: [
      { name: "prompt", type: "string", required: true, description: "Description of audio (e.g., 'upbeat electronic dance music with heavy bass')" },
      { name: "duration", type: "number", required: false, description: "Duration in seconds (1-47)", default: 10 },
      { name: "seed", type: "number", required: false, description: "Random seed for reproducibility" },
    ],
  },
  {
    name: "image_to_3d",
    description: "Convert an image to a 3D GLB model using Hunyuan 3D",
    parameters: [
      { name: "image_id", type: "string", required: true, description: "Upload ID of the input image" },
      { name: "seed", type: "number", required: false, description: "Random seed for reproducibility" },
    ],
  },
  {
    name: "generate_image",
    description: "Generate an image from text description. Use for: photos, artwork, illustrations, diagrams, scenes, visual concepts. Do NOT use for text content (poems, stories, essays, code) - write those directly.",
    parameters: [
      { name: "prompt", type: "string", required: true, description: "Detailed description of the image" },
      { name: "width", type: "number", required: false, description: "Image width (512-1024)", default: 768 },
      { name: "height", type: "number", required: false, description: "Image height (512-1024)", default: 768 },
      { name: "seed", type: "number", required: false, description: "Random seed for reproducibility" },
    ],
  },
  {
    name: "analyze_image",
    description: "Analyze and answer questions about an image using vision AI",
    parameters: [
      { name: "image_id", type: "string", required: true, description: "Upload ID of the image to analyze" },
      { name: "question", type: "string", required: false, description: "Specific question about the image" },
    ],
  },
  {
    name: "web_search",
    description: "Search the web for current information. Use for: news, facts, prices, sports scores, research. If results are incomplete, search again with refined queries until you get concrete answers.",
    parameters: [
      { name: "query", type: "string", required: true, description: "Search query" },
      { name: "max_results", type: "number", required: false, description: "Max results (1-10)", default: 5 },
    ],
  },
  {
    name: "glyph_motif",
    description: "ONLY for procedural SVG patterns when user EXPLICITLY requests: sigil, mandala, geometric symbol, rune, or SVG icon. Never use for text content (poems, stories, code). For photos/illustrations use generate_image.",
    parameters: [
      { name: "prompt", type: "string", required: true, description: "Theme for the geometric pattern" },
      { name: "style", type: "string", required: false, description: "Pattern style: sigil, rune, mandala, circuit, organic", default: "sigil" },
      { name: "size", type: "number", required: false, description: "Size 64-512 pixels", default: 256 },
      { name: "seed", type: "number", required: false, description: "Random seed" },
      { name: "sheet", type: "boolean", required: false, description: "Generate 4x4 spritesheet", default: false },
    ],
  },
  {
    name: "execute_code",
    description: "Execute code in a sandboxed environment. Output displays in Canvas with syntax highlighting, stdout/stderr streaming, and visual previews. Use for: running algorithms, data processing, demonstrations, visualizations, web previews (React/HTML/Three.js), testing code snippets.",
    parameters: [
      { name: "language", type: "string", required: true, description: "Language: python, lua, go, c, javascript, typescript, bash, html, react, threejs" },
      { name: "code", type: "string", required: true, description: "Source code to execute" },
      { name: "filename", type: "string", required: false, description: "Optional filename (auto-generated if not provided)" },
      { name: "args", type: "array", required: false, description: "Command line arguments" },
      { name: "stdin", type: "string", required: false, description: "Standard input data" },
      { name: "timeout", type: "number", required: false, description: "Timeout in ms (1000-60000)", default: 30000 },
    ],
  },
  {
    name: "vector_search",
    description: "Search for semantically similar documents in the local VectorDB. Use for: finding related information, semantic search, knowledge retrieval, finding context for questions. Supports hybrid search (combined vector + keyword) for best results.",
    parameters: [
      { name: "query", type: "string", required: true, description: "Search query - will find semantically similar documents" },
      { name: "collection", type: "string", required: false, description: "Collection to search (omit to search all)" },
      { name: "k", type: "number", required: false, description: "Number of results (1-100)", default: 5 },
      { name: "mode", type: "string", required: false, description: "Search mode: 'hybrid' (best quality), 'vector' (semantic only), 'lexical' (keyword only)", default: "hybrid" },
      { name: "filter", type: "object", required: false, description: "Metadata filter - only return docs matching all key-value pairs" },
    ],
  },
  {
    name: "vector_store",
    description: "Store a document in VectorDB for future semantic retrieval. Use for: saving important information, building knowledge bases, storing facts for later retrieval.",
    parameters: [
      { name: "text", type: "string", required: true, description: "Document text to store" },
      { name: "collection", type: "string", required: false, description: "Collection name", default: "default" },
      { name: "metadata", type: "object", required: false, description: "Optional key-value metadata" },
    ],
  },
  {
    name: "vector_ingest",
    description: "Fetch content from a URL and store it in VectorDB with automatic chunking. Use for: ingesting web pages, documentation, articles, or any URL content into the knowledge base. Automatically splits large documents into searchable chunks.",
    parameters: [
      { name: "url", type: "string", required: true, description: "URL to fetch and ingest" },
      { name: "collection", type: "string", required: false, description: "Collection name", default: "default" },
      { name: "metadata", type: "object", required: false, description: "Optional key-value metadata" },
    ],
  },
  {
    name: "native_locate",
    description: "Query the host OS accessibility tree for matching UI elements. Linux uses AT-SPI, macOS AX, Windows UIA.",
    parameters: [
      { name: "name", type: "string", required: false, description: "Accessible name substring" },
      { name: "role", type: "string", required: false, description: "Role filter (button, window, etc.)" },
      { name: "app", type: "string", required: false, description: "Application name hint" },
      { name: "limit", type: "number", required: false, description: "Max results", default: 10 },
    ],
  },
  {
    name: "native_click",
    description: "Click a native UI element by handle returned from native_locate.",
    parameters: [
      { name: "handle", type: "object", required: true, description: "Handle object from native_locate" },
    ],
  },
  {
    name: "native_type",
    description: "Type text into a native UI element (pass handle) or the focused element (handle=null).",
    parameters: [
      { name: "handle", type: "object", required: false, description: "Target handle; null/omit for focused" },
      { name: "text", type: "string", required: true, description: "Text to type" },
    ],
  },
  {
    name: "native_tree",
    description: "Dump a native accessibility tree rooted at handle (or desktop if omitted). Depth-limited for sanity.",
    parameters: [
      { name: "handle", type: "object", required: false, description: "Root handle; omit for desktop" },
    ],
  },
  {
    name: "native_key",
    description: "Send a keystroke or combo to the focused widget. Use for GTK4 gaps (Main Menu, sidebar rows) and keyboard shortcuts.",
    parameters: [
      {
        name: "key",
        type: "string",
        required: true,
        description: "Single char, keysym ('Return','Tab','F10','Escape','Down','Left'), or '+'-combo ('Ctrl+l','Alt+F10')",
      },
    ],
  },
  {
    name: "native_focus",
    description: "Move keyboard focus to a native UI element by handle. Often a prerequisite for native_key to hit the right target.",
    parameters: [
      { name: "handle", type: "object", required: true, description: "Handle object from native_locate" },
    ],
  },
  {
    name: "native_screen_grab",
    description: "Capture the full desktop as a PNG via xdg-desktop-portal. Returns base64 png bytes + width/height. Use for visual verification, OCR pipelines, or feeding an image to analyze_image.",
    parameters: [],
  },
  {
    name: "native_focus_window",
    description: "Raise and focus a running Linux app by desktop app-id (e.g. 'org.telegram.desktop'). Mints a real xdg_activation token so Mutter honours the request. Prerequisite for native_key/native_type when the target isn't already focused.",
    parameters: [
      { name: "app_id", type: "string", required: true, description: "Desktop app-id (without .desktop suffix)" },
    ],
  },
  {
    name: "native_click_pixel",
    description: "Click at absolute desktop pixel coords via xdg-desktop-portal RemoteDesktop + ScreenCast. First call prompts for screen-share permission (once per app install). Use when AT-SPI widget extents are unavailable (Qt on Wayland) and you have visual coordinates from native_screen_grab.",
    parameters: [
      { name: "x", type: "number", required: true, description: "Absolute desktop X pixel" },
      { name: "y", type: "number", required: true, description: "Absolute desktop Y pixel" },
      { name: "button", type: "string", required: false, description: "'left', 'right', or 'middle'", default: "left" },
    ],
  },
  {
    name: "native_invoke",
    description: "Windows only — dispatch a UI Automation control pattern (Invoke, Toggle, ExpandCollapse, RangeValue.SetValue, Value.SetValue, SelectionItem.Select, Window.Close) directly against a handle. Bypasses synthetic input — far more reliable than native_click for complex controls (ribbon menus, treeviews, spinners). Returns unsupported_platform on Linux/macOS.",
    parameters: [
      { name: "handle", type: "object", required: true, description: "Handle object from native_locate" },
      { name: "pattern", type: "string", required: true, description: "UIA pattern name (Invoke, Toggle, ExpandCollapse, RangeValue, Value, SelectionItem, Window)" },
      { name: "action", type: "string", required: true, description: "Pattern-specific action (e.g. 'Invoke', 'Toggle', 'Expand', 'SetValue', 'Select', 'Close')" },
      { name: "params", type: "object", required: false, description: "Action params (e.g. { value: 42 } for RangeValue.SetValue)" },
    ],
  },
  {
    name: "native_wait_for",
    description: "Windows only — subscribe to a UIA automation event (structure_changed, focus_changed, property_changed) and resolve when a matching event arrives or the timeout elapses. Use instead of polling loops for 'wait until dialog opens' / 'wait until button enables'. Returns unsupported_platform on Linux/macOS.",
    parameters: [
      { name: "event", type: "string", required: true, description: "'structure_changed' | 'focus_changed' | 'property_changed'" },
      { name: "handle", type: "object", required: false, description: "Anchor handle; defaults to desktop root" },
      { name: "match", type: "object", required: false, description: "Predicate (name, role, automationId, property) applied to the event element" },
      { name: "timeoutMs", type: "number", required: false, description: "Timeout in ms (default 30000, max 60000)" },
    ],
  },
  {
    name: "native_element_from_point",
    description: "Windows only — resolve the UIA element at an absolute desktop pixel coord. Turns pointer coords into a semantic handle for 'what's under the cursor' workflows. Returns unsupported_platform on Linux/macOS.",
    parameters: [
      { name: "x", type: "number", required: true, description: "Absolute desktop X pixel" },
      { name: "y", type: "number", required: true, description: "Absolute desktop Y pixel" },
    ],
  },
  {
    name: "native_read_text",
    description: "Windows only — read structured text from a UIA TextPattern element (documents, rich-text edit controls). Returns the text plus current selection ranges. Reads rich text without OCR. Returns unsupported_platform on Linux/macOS.",
    parameters: [
      { name: "handle", type: "object", required: true, description: "Handle of a TextPattern-supporting element" },
      { name: "range", type: "object", required: false, description: "Optional {start, end} character offsets; omit for the full text" },
    ],
  },
  {
    name: "native_with_cache",
    description: "Windows only — run a batch of sub-ops (locate, tree, read_text) against a cached subtree in one round-trip. 10-100× faster than cold tree walks for large surfaces (Explorer, Outlook). Returns unsupported_platform on Linux/macOS.",
    parameters: [
      { name: "handle", type: "object", required: false, description: "Subtree anchor; defaults to desktop" },
      { name: "depth", type: "number", required: false, description: "Cache depth (1-50)" },
      { name: "ops", type: "array", required: true, description: "Sub-ops: [{op:'locate', query:{...}} | {op:'tree'} | {op:'read_text', handle:{...}}]" },
    ],
  },
  {
    name: "native_watch_install",
    description: "Windows only — install a background watcher that fires when a matching window/dialog appears anywhere on the desktop. Agents should install watchers before any risky multi-step flow (dialogs steal focus silently otherwise). Default action 'notify' never auto-clicks — agent drains and decides. Never use action 'invoke_button' for consent-critical prompts (UAC, save-changes, password). Returns unsupported_platform on Linux/macOS.",
    parameters: [
      { name: "match", type: "object", required: true, description: "{name?, role?, automationId?, app?} — substring + case-insensitive" },
      { name: "action", type: "string", required: false, description: "'notify' | 'dismiss_via_escape' | 'invoke_button'", default: "notify" },
      { name: "buttonName", type: "string", required: false, description: "Required when action=invoke_button" },
      { name: "scope", type: "string", required: false, description: "'desktop' | 'app'", default: "desktop" },
      { name: "ttlMs", type: "number", required: false, description: "TTL in ms (1000-1800000, default 300000)" },
    ],
  },
  {
    name: "native_watch_drain",
    description: "Windows only — read queued events from one or all active watchers. Drain between every risky action. Returns unsupported_platform on Linux/macOS.",
    parameters: [
      { name: "watchId", type: "string", required: false, description: "Specific watcher; omit for all" },
    ],
  },
  {
    name: "native_watch_remove",
    description: "Windows only — remove an installed watcher.",
    parameters: [
      { name: "watchId", type: "string", required: true, description: "Watcher id from native_watch_install" },
    ],
  },
  {
    name: "native_baseline_capture",
    description: "Windows only — capture a named 'known-good state' snapshot of the desktop (foreground window, top-level windows, modal depth). Pair with native_baseline_restore as an emergency parachute when the agent lands in an unexpected state.",
    parameters: [
      { name: "label", type: "string", required: false, description: "Optional label for debugging" },
    ],
  },
  {
    name: "native_baseline_restore",
    description: "Windows only — close windows introduced since a baseline was captured. Hung windows ('Not Responding') are skipped and surfaced as residuals, never force-closed. Never affects UAC or secure-desktop dialogs (not reachable from non-elevated process).",
    parameters: [
      { name: "baselineId", type: "string", required: true, description: "Id from native_baseline_capture" },
      { name: "strategy", type: "string", required: false, description: "'close_modals' | 'close_modals_then_focus'", default: "close_modals" },
    ],
  },
  {
    name: "workspace_open_pane",
    description: "Open a new pane in the user's workspace (must be on /deck/workspace). Fire-and-forget: the command relays to any connected WorkspaceShell which adds the panel via Dockview. Types: chat, terminal, canvas, browser, notes, agentgo, audio, comfy, control, models, runs, tools, voice.",
    parameters: [
      { name: "type", type: "string", required: true, description: "Pane component key" },
      { name: "title", type: "string", required: false, description: "Tab title; defaults to the type name" },
      { name: "position", type: "string", required: false, description: "'left' | 'right' | 'above' | 'below' — split direction; omit to add as tab" },
      { name: "referencePane", type: "string", required: false, description: "Pane id to position relative to; omit to use the focused group" },
    ],
  },
  {
    name: "workspace_close_pane",
    description: "Close a workspace pane by its handle id. Fire-and-forget.",
    parameters: [
      { name: "paneId", type: "string", required: true, description: "Pane handle id (<type>:<instanceId>) or Dockview panel id" },
    ],
  },
  {
    name: "workspace_focus_pane",
    description: "Bring a workspace pane into focus.",
    parameters: [
      { name: "paneId", type: "string", required: true, description: "Pane id to focus" },
    ],
  },
  {
    name: "workspace_reset",
    description: "Reset the user's workspace to the default layout (chat | terminal | notes). Fire-and-forget.",
    parameters: [],
  },
  {
    name: "workspace_list_panes",
    description: "Query the workspace for a snapshot of every registered pane — handle id, type, label, capabilities, declared topics + their current rate. Use this before workspace_pane_call to discover what's callable. Returns within 5s or errors if /deck/workspace isn't open.",
    parameters: [],
  },
  {
    name: "workspace_pane_call",
    description: "Synchronously invoke a capability on a specific workspace pane. Pass target=pane-handle-id (see workspace_list_panes), capability=name of the capability, args=payload. Result is the capability's return value. 5s timeout. Use for rich operations like chat.append_text, terminal.send_keys, canvas.load_code, notes.replace_text, browser.navigate.",
    parameters: [
      { name: "target", type: "string", required: true, description: "Pane handle id" },
      { name: "capability", type: "string", required: true, description: "Capability name" },
      { name: "args", type: "object", required: false, description: "Payload for the capability handler" },
    ],
  },
];

// JSON format: ```json\n{"tool": "name", "args": {...}}\n``` or inline {"tool": "name", "args": {...}}
const TOOL_JSON_REGEX = /```json\s*\n?\s*(\{[\s\S]*?"tool"[\s\S]*?\})\s*\n?\s*```|\{"tool"\s*:\s*"([^"]+)"\s*,\s*"args"\s*:\s*(\{[\s\S]*?\})\s*\}/;

// Legacy XML format: <tool name="name">{...}</tool>
const TOOL_XML_REGEX = /<tool\s+name="([^"]+)">([\s\S]*?)<\/tool>/;

export function parseToolCall(text: string): ToolCall | null {
  // Try JSON format first (preferred)
  const jsonMatch = text.match(TOOL_JSON_REGEX);
  if (jsonMatch) {
    try {
      let toolName: string;
      let args: unknown;
      
      if (jsonMatch[1]) {
        // Full JSON object in code block
        const json = JSON.parse(jsonMatch[1]);
        toolName = json.tool;
        args = json.args;
      } else {
        // Inline JSON
        toolName = jsonMatch[2];
        args = JSON.parse(jsonMatch[3]);
      }
      
      const result = ToolCallSchema.safeParse({ name: toolName, args });
      if (result.success) {
        return result.data;
      } else {
        console.error("Tool validation failed:", result.error.format());
      }
    } catch (e) {
      console.error("JSON tool parse error:", e);
    }
  }
  
  // Fallback to XML format for backwards compatibility
  const xmlMatch = text.match(TOOL_XML_REGEX);
  if (xmlMatch) {
    try {
      const name = xmlMatch[1];
      const argsJson = xmlMatch[2].trim();
      const args = JSON.parse(argsJson);
      
      const result = ToolCallSchema.safeParse({ name, args });
      if (result.success) {
        return result.data;
      } else {
        console.error("Tool validation failed:", result.error.format());
      }
    } catch (e) {
      console.error("XML tool parse error:", e);
    }
  }
  
  return null;
}

/**
 * Extract all tool calls from text (supports both formats)
 */
export function parseAllToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = [];
  
  // Try JSON format
  const jsonRegex = /```json\s*\n?\s*(\{[\s\S]*?"tool"[\s\S]*?\})\s*\n?\s*```|\{"tool"\s*:\s*"([^"]+)"\s*,\s*"args"\s*:\s*(\{[\s\S]*?\})\s*\}/g;
  let match;
  
  while ((match = jsonRegex.exec(text)) !== null) {
    try {
      let toolName: string;
      let args: unknown;
      
      if (match[1]) {
        const json = JSON.parse(match[1]);
        toolName = json.tool;
        args = json.args;
      } else {
        toolName = match[2];
        args = JSON.parse(match[3]);
      }
      
      const result = ToolCallSchema.safeParse({ name: toolName, args });
      if (result.success) {
        calls.push(result.data);
      }
    } catch {
      // Skip invalid
    }
  }
  
  // Also check XML format
  const xmlRegex = /<tool\s+name="([^"]+)">([\s\S]*?)<\/tool>/g;
  while ((match = xmlRegex.exec(text)) !== null) {
    try {
      const name = match[1];
      const args = JSON.parse(match[2].trim());
      
      const result = ToolCallSchema.safeParse({ name, args });
      if (result.success) {
        // Avoid duplicates
        if (!calls.some(c => c.name === result.data.name)) {
          calls.push(result.data);
        }
      }
    } catch {
      // Skip invalid
    }
  }

  return calls;
}
