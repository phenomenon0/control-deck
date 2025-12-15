/**
 * Tool Definitions - Pydantic-style typed schemas using Zod
 * All tools available to the LLM are defined here with full validation
 */

import { z } from "zod";

// ============================================================================
// Individual Tool Schemas
// ============================================================================

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

// ============================================================================
// Union Schema - All Tools
// ============================================================================

export const ToolCallSchema = z.discriminatedUnion("name", [
  EditImageSchema,
  GenerateAudioSchema,
  ImageTo3DSchema,
  GenerateImageSchema,
  AnalyzeImageSchema,
  WebSearchSchema,
  GlyphMotifSchema,
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

// ============================================================================
// Tool Metadata for System Prompt Generation
// ============================================================================

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
    description: "Generate a picture/photo/artwork. Use ONLY when user explicitly requests an image, photo, illustration, drawing, render, or visual artwork. Do NOT use for text content (poems, stories, essays, code).",
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
    description: "Search the web for current information (auto-triggered for news, prices, recent events)",
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
];



// ============================================================================
// Tool Call Parser (supports both JSON and legacy XML formats)
// ============================================================================

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
