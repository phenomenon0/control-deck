/**
 * Ollama/OpenAI Tool Schema Renderer
 * 
 * Generates OpenAI-compatible tool definitions from ToolSpec[].
 * Used for native tool calling with qwen3, llama3.2, mistral, etc.
 */

import {
  type ToolSpec,
  type FieldSpec,
  extractToolSpec,
} from "./zod-introspect";

import {
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
  TOOL_DEFINITIONS,
} from "./definitions";

export interface OllamaToolParameter {
  type: string;
  description: string;
  enum?: string[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
}

export interface OllamaTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, OllamaToolParameter>;
      required: string[];
    };
  };
}

/**
 * Map FieldSpec type to JSON Schema type
 */
function fieldTypeToJsonType(type: string): string {
  switch (type) {
    case "str":
      return "string";
    case "num":
      return "number";
    case "bool":
      return "boolean";
    case "arr":
      return "array";
    case "obj":
      return "object";
    case "enum":
      return "string";
    default:
      return "string";
  }
}

/**
 * Convert a FieldSpec to OpenAI parameter format
 */
function fieldToOllamaParam(field: FieldSpec): OllamaToolParameter {
  const param: OllamaToolParameter = {
    type: fieldTypeToJsonType(field.type),
    description: field.description || field.name,
  };
  
  // Add enum values
  if (field.enumValues) {
    param.enum = field.enumValues;
  }
  
  // Add default value to description (OpenAI format doesn't have native default)
  if (field.default !== undefined) {
    param.description += `, default: ${field.default}`;
  }
  
  // Add range to description
  if (field.min !== undefined || field.max !== undefined) {
    const range = `${field.min ?? ""}..${field.max ?? ""}`;
    param.description += ` (${range})`;
  }
  
  return param;
}

/**
 * Convert a ToolSpec to Ollama tool format
 */
export function toolSpecToOllama(spec: ToolSpec): OllamaTool {
  const properties: Record<string, OllamaToolParameter> = {};
  const required: string[] = [];
  
  for (const param of spec.params) {
    properties[param.name] = fieldToOllamaParam(param);
    if (param.required) {
      required.push(param.name);
    }
  }
  
  return {
    type: "function",
    function: {
      name: spec.name,
      description: spec.description,
      parameters: {
        type: "object",
        properties,
        required,
      },
    },
  };
}

const ALL_TOOL_SCHEMAS = [
  GenerateImageSchema,
  EditImageSchema,
  GenerateAudioSchema,
  ImageTo3DSchema,
  AnalyzeImageSchema,
  WebSearchSchema,
  GlyphMotifSchema,
  ExecuteCodeSchema,
  VectorSearchSchema,
  VectorStoreSchema,
];

let _cachedTools: OllamaTool[] | null = null;

/**
 * Get description from TOOL_DEFINITIONS (fallback until we migrate to Zod .describe())
 */
function getToolDescription(name: string): string {
  const def = TOOL_DEFINITIONS.find(t => t.name === name);
  return def?.description || "";
}

/**
 * Get all tools in Ollama/OpenAI format
 * Generated from Zod schemas (single source of truth)
 */
export function getOllamaTools(): OllamaTool[] {
  if (!_cachedTools) {
    const specs = ALL_TOOL_SCHEMAS.map(schema => {
      const spec = extractToolSpec(schema);
      // Fallback to TOOL_DEFINITIONS for description
      if (!spec.description) {
        spec.description = getToolDescription(spec.name);
      }
      return spec;
    });
    _cachedTools = specs.map(toolSpecToOllama);
  }
  return _cachedTools;
}

/**
 * Get a single tool by name
 */
export function getOllamaTool(name: string): OllamaTool | undefined {
  return getOllamaTools().find(t => t.function.name === name);
}

export const NATIVE_TOOL_MODELS = [
  "qwen3",
  "qwen2.5",
  "llama3.2",
  "llama3.1",
  "mistral",
  "mixtral",
  "command-r",
  "firefunction",
];

/**
 * Check if a model supports native tool calling
 */
export function supportsNativeTools(model: string): boolean {
  const modelLower = model.toLowerCase();
  return NATIVE_TOOL_MODELS.some((supported) => modelLower.includes(supported));
}

export function printOllamaTools(): void {
  console.log("=== OLLAMA TOOLS (generated from Zod) ===\n");
  console.log(JSON.stringify(getOllamaTools(), null, 2));
}
