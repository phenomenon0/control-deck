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

export const LivePlaySchema = z.object({
  name: z.literal("live.play"),
  args: z.object({
    action: z.enum(["start", "stop", "toggle"]).describe("Transport action"),
  }),
});

export const LiveSetTrackSchema = z.object({
  name: z.literal("live.set_track"),
  args: z.object({
    track: z.number().int().min(0).max(7).describe("Track index (0-7)"),
    pattern: z.string().describe("Pattern string (e.g. 'bd ~ sd ~ bd ~ sd ~')"),
    name: z.string().optional().describe("Optional track name"),
  }),
});

export const LiveApplyScriptSchema = z.object({
  name: z.literal("live.apply_script"),
  args: z.object({
    script: z.string().min(1).max(6000).describe("Full live pattern script with bpm, track, fx, and sample lines"),
    play: z.boolean().default(false).describe("Start playback after applying the script"),
  }),
});

export const LiveFxSchema = z.object({
  name: z.literal("live.fx"),
  args: z.object({
    track: z.number().int().min(0).max(7).describe("Track index (0-7)"),
    action: z.enum(["add", "remove"]).describe("Add or remove effect"),
    type: z.enum(["reverb", "delay", "chorus", "filter", "distortion"]).optional().describe("Effect type (required for add)"),
    index: z.number().int().min(0).optional().describe("Effect index (required for remove)"),
    wet: z.number().min(0).max(1).optional().describe("Wet mix (0-1, default varies by type)"),
  }),
});

export const LiveLoadSampleSchema = z.object({
  name: z.literal("live.load_sample"),
  args: z.object({
    track: z.number().int().min(0).max(7).describe("Track index (0-7)"),
    artifact_id: z.string().describe("Artifact ID of audio to load"),
    name: z.string().max(32).optional().describe("Optional track/sample name"),
  }),
});

export const LiveGenerateSampleSchema = z.object({
  name: z.literal("live.generate_sample"),
  args: z.object({
    track: z.number().int().min(0).max(7).describe("Track index (0-7)"),
    prompt: z.string().min(1).max(600).describe("Description of the sample to generate"),
    duration: z.number().min(1).max(47).default(8).describe("Duration in seconds (1-47)"),
    seed: z.number().int().min(0).optional().describe("Random seed for reproducibility"),
    name: z.string().max(32).optional().describe("Optional track/sample name"),
    loader: z.enum(["stable-audio", "ace-step"]).default("stable-audio").describe("Local audio loader"),
  }),
});

export const LiveBpmSchema = z.object({
  name: z.literal("live.bpm"),
  args: z.object({
    bpm: z.number().int().min(40).max(300).describe("Tempo in BPM (40-300)"),
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
  LivePlaySchema,
  LiveSetTrackSchema,
  LiveApplyScriptSchema,
  LiveFxSchema,
  LiveLoadSampleSchema,
  LiveGenerateSampleSchema,
  LiveBpmSchema,
  NativeLocateSchema,
  NativeClickSchema,
  NativeTypeSchema,
  NativeTreeSchema,
  NativeKeySchema,
  NativeFocusSchema,
]);

export type ToolCall = z.infer<typeof ToolCallSchema>;
export type ToolName = ToolCall["name"];

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
export type LivePlayArgs = z.infer<typeof LivePlaySchema>["args"];
export type LiveSetTrackArgs = z.infer<typeof LiveSetTrackSchema>["args"];
export type LiveApplyScriptArgs = z.infer<typeof LiveApplyScriptSchema>["args"];
export type LiveFxArgs = z.infer<typeof LiveFxSchema>["args"];
export type LiveLoadSampleArgs = z.infer<typeof LiveLoadSampleSchema>["args"];
export type LiveGenerateSampleArgs = z.infer<typeof LiveGenerateSampleSchema>["args"];
export type LiveBpmArgs = z.infer<typeof LiveBpmSchema>["args"];
export type NativeLocateArgs = z.infer<typeof NativeLocateSchema>["args"];
export type NativeClickArgs = z.infer<typeof NativeClickSchema>["args"];
export type NativeTypeArgs = z.infer<typeof NativeTypeSchema>["args"];
export type NativeTreeArgs = z.infer<typeof NativeTreeSchema>["args"];
export type NativeKeyArgs = z.infer<typeof NativeKeySchema>["args"];
export type NativeFocusArgs = z.infer<typeof NativeFocusSchema>["args"];

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
    name: "live.play",
    description: "Control the live music transport — start, stop, or toggle playback",
    parameters: [
      { name: "action", type: "string", required: true, description: "Transport action: start, stop, or toggle" },
    ],
  },
  {
    name: "live.set_track",
    description: "Set a pattern on a live sequencer track using mini-notation (e.g. 'bd ~ sd ~', 'c3 eb3 g3 ~')",
    parameters: [
      { name: "track", type: "number", required: true, description: "Track index (0-7)" },
      { name: "pattern", type: "string", required: true, description: "Pattern string" },
      { name: "name", type: "string", required: false, description: "Optional track name" },
    ],
  },
  {
    name: "live.apply_script",
    description: "Apply a full live pattern script containing bpm, track patterns, FX chains, and sample intents. Best tool when composing a multi-track idea.",
    parameters: [
      { name: "script", type: "string", required: true, description: "Full pattern script" },
      { name: "play", type: "boolean", required: false, description: "Start playback after applying", default: false },
    ],
  },
  {
    name: "live.fx",
    description: "Add or remove an effect on a live sequencer track",
    parameters: [
      { name: "track", type: "number", required: true, description: "Track index (0-7)" },
      { name: "action", type: "string", required: true, description: "add or remove" },
      { name: "type", type: "string", required: false, description: "Effect type: reverb, delay, chorus, filter, distortion" },
      { name: "index", type: "number", required: false, description: "Effect index to remove" },
      { name: "wet", type: "number", required: false, description: "Wet mix 0-1" },
    ],
  },
  {
    name: "live.load_sample",
    description: "Load a generated audio artifact into a live sequencer track for looped playback",
    parameters: [
      { name: "track", type: "number", required: true, description: "Track index (0-7)" },
      { name: "artifact_id", type: "string", required: true, description: "Artifact ID of audio to load" },
      { name: "name", type: "string", required: false, description: "Optional track/sample name" },
    ],
  },
  {
    name: "live.generate_sample",
    description: "Generate an audio sample for a live track and load it into that track. Uses ComfyUI Stable Audio by default; use ace-step only when ACE-Step nodes/model are installed.",
    parameters: [
      { name: "track", type: "number", required: true, description: "Track index (0-7)" },
      { name: "prompt", type: "string", required: true, description: "Sample prompt" },
      { name: "duration", type: "number", required: false, description: "Duration in seconds (1-47)", default: 8 },
      { name: "seed", type: "number", required: false, description: "Random seed" },
      { name: "name", type: "string", required: false, description: "Optional track/sample name" },
      { name: "loader", type: "string", required: false, description: "stable-audio or ace-step", default: "stable-audio" },
    ],
  },
  {
    name: "live.bpm",
    description: "Set the tempo of the live sequencer",
    parameters: [
      { name: "bpm", type: "number", required: true, description: "Tempo in BPM (40-300)" },
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
