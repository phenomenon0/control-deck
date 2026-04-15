/**
 * GLYPH Catalog Renderer
 * 
 * Generates compact, structured tool documentation for LLM context.
 * Consumes ToolSpec[] from zod-introspect.ts.
 * 
 * Output format:
 * 1. Index table: @tab[tool req opt returns](...)
 * 2. Detail blocks: constraints, enums, ranges (only for complex tools)
 * 3. Result shapes: nested output structure (only for search tools)
 */

import {
  type ToolSpec,
  type FieldSpec,
  extractToolSpec,
  hasComplexParams,
  getRequiredParams,
  getOptionalParams,
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

export type ToolGroup = "Media" | "Search" | "Code" | "Memory";

export interface ToolMeta {
  group: ToolGroup;
  returns: string;
  icon?: string;
  /** If true, include in detail blocks even if params are simple */
  forceDetail?: boolean;
}

export const TOOL_META: Record<string, ToolMeta> = {
  generate_image: { group: "Media", returns: "artifact:image", icon: "image" },
  edit_image: { group: "Media", returns: "artifact:image", icon: "edit" },
  generate_audio: { group: "Media", returns: "artifact:audio", icon: "audio" },
  image_to_3d: { group: "Media", returns: "artifact:3d", icon: "cube" },
  analyze_image: { group: "Media", returns: "text", icon: "eye" },
  glyph_motif: { group: "Media", returns: "artifact:svg", icon: "pattern" },
  web_search: { group: "Search", returns: "json:results[]", icon: "globe", forceDetail: true },
  vector_search: { group: "Memory", returns: "json:docs[]", icon: "search", forceDetail: true },
  vector_store: { group: "Memory", returns: "json:id", icon: "save" },
  execute_code: { group: "Code", returns: "text+artifacts", icon: "code" },
};

// Result shapes for tools with nested output
export const RESULT_SHAPES: Record<string, FieldSpec[]> = {
  web_search: [
    { name: "results", type: "arr", required: true, elementType: "obj" },
    { name: "results[].title", type: "str", required: true },
    { name: "results[].url", type: "str", required: true },
    { name: "results[].snippet", type: "str", required: true },
  ],
  vector_search: [
    { name: "docs", type: "arr", required: true, elementType: "obj" },
    { name: "docs[].id", type: "str", required: true },
    { name: "docs[].score", type: "num", required: true },
    { name: "docs[].text", type: "str", required: true },
    { name: "docs[].metadata", type: "obj", required: false },
  ],
};

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

let _cachedSpecs: ToolSpec[] | null = null;

/**
 * Get description from TOOL_DEFINITIONS (fallback until we migrate to Zod .describe())
 */
function getToolDescription(name: string): string {
  const def = TOOL_DEFINITIONS.find(t => t.name === name);
  return def?.description || "";
}

export function getAllToolSpecs(): ToolSpec[] {
  if (!_cachedSpecs) {
    _cachedSpecs = ALL_TOOL_SCHEMAS.map(schema => {
      const spec = extractToolSpec(schema);
      // Fallback to TOOL_DEFINITIONS for description
      if (!spec.description) {
        spec.description = getToolDescription(spec.name);
      }
      return spec;
    });
  }
  return _cachedSpecs;
}

/**
 * Format a field as "name:type" or "name:type=default"
 */
function formatField(f: FieldSpec, includeDefault: boolean): string {
  let type: string = f.type;
  
  // Short enum values inline if ≤3 options
  if (f.enumValues) {
    if (f.enumValues.length <= 3) {
      type = f.enumValues.join("|");
    } else {
      type = "enum";
    }
  }
  
  if (includeDefault && f.default !== undefined) {
    return `${f.name}:${type}=${f.default}`;
  }
  
  return `${f.name}:${type}`;
}

/**
 * Format required params as comma-separated list
 */
function formatReqParams(params: FieldSpec[]): string {
  if (params.length === 0) return "-";
  return params.map(p => formatField(p, false)).join(",");
}

/**
 * Format optional params with defaults
 */
function formatOptParams(params: FieldSpec[]): string {
  if (params.length === 0) return "-";
  return params.map(p => formatField(p, true)).join(",");
}

/**
 * Render the main tool index table
 * 
 * Output:
 * @tab[tool req opt returns](
 *   ["generate_image","prompt:str","width:num=768,height:num=768,seed:num","artifact:image"]
 *   ...
 * )
 */
export function renderToolIndexGlyph(specs?: ToolSpec[]): string {
  const tools = specs ?? getAllToolSpecs();
  
  const rows = tools.map(spec => {
    const meta = TOOL_META[spec.name] || { group: "Other", returns: "json" };
    const req = formatReqParams(getRequiredParams(spec));
    const opt = formatOptParams(getOptionalParams(spec));
    
    return `  ["${spec.name}","${req}","${opt}","${meta.returns}"]`;
  });
  
  return `@tab[tool req opt returns](\n${rows.join("\n")}\n)`;
}

/**
 * Check if a tool needs a detail block
 */
export function needsDetailBlock(spec: ToolSpec): boolean {
  const meta = TOOL_META[spec.name];
  if (meta?.forceDetail) return true;
  return hasComplexParams(spec);
}

/**
 * Render detail block for a single tool
 * Only includes: constraints (min/max), enums (if >3 values), ranges
 * 
 * Output:
 * # generate_image
 * @tab[param range](["width","512..1024"]["height","512..1024"])
 */
export function renderToolDetailGlyph(spec: ToolSpec): string | null {
  if (!needsDetailBlock(spec)) return null;
  
  const lines: string[] = [`# ${spec.name}`];
  
  // Collect constraints
  const rangeParams = spec.params.filter(p => p.min !== undefined || p.max !== undefined);
  const enumParams = spec.params.filter(p => p.enumValues && p.enumValues.length > 3);
  
  // Range table
  if (rangeParams.length > 0) {
    const rows = rangeParams.map(p => {
      const range = `${p.min ?? ""}..${p.max ?? ""}`;
      return `["${p.name}","${range}"]`;
    });
    lines.push(`@tab[param range](${rows.join("")})`);
  }
  
  // Long enums (one per line)
  for (const p of enumParams) {
    lines.push(`${p.name}: ${p.enumValues!.join("|")}`);
  }
  
  return lines.length > 1 ? lines.join("\n") : null;
}

/**
 * Render all detail blocks
 */
export function renderAllDetailBlocks(specs?: ToolSpec[]): string {
  const tools = specs ?? getAllToolSpecs();
  
  const blocks = tools
    .map(renderToolDetailGlyph)
    .filter((b): b is string => b !== null);
  
  return blocks.join("\n\n");
}

/**
 * Render result shape for a tool (if it has nested output)
 * 
 * Output:
 * # vector_search result
 * @tab[field type](["docs","obj[]"]["docs[].id","str"]["docs[].score","num"]["docs[].text","str"])
 */
export function renderResultShapeGlyph(toolName: string): string | null {
  const shape = RESULT_SHAPES[toolName];
  if (!shape) return null;
  
  const rows = shape.map(f => {
    let type: string = f.type;
    if (f.elementType) type = `${f.elementType}[]`;
    return `["${f.name}","${type}"]`;
  });
  
  return `# ${toolName} result\n@tab[field type](${rows.join("")})`;
}

/**
 * Render all result shapes
 */
export function renderAllResultShapes(): string {
  const shapes = Object.keys(RESULT_SHAPES)
    .map(renderResultShapeGlyph)
    .filter((s): s is string => s !== null);
  
  return shapes.join("\n\n");
}

/**
 * Render the complete GLYPH tool catalog for system prompt
 * 
 * Includes:
 * 1. Header with conventions
 * 2. Index table (all tools)
 * 3. Detail blocks (complex tools only)
 * 4. Result shapes (search tools only)
 * 5. GLYPH reading guide
 */
export function renderToolCatalogGlyph(): string {
  const specs = getAllToolSpecs();
  
  const sections: string[] = [];
  
  // Header
  sections.push(`# Tools

Call tools using the function-calling interface.
Use tool names exactly as listed. If an arg is omitted, defaults apply as shown.`);
  
  // Index table
  sections.push(renderToolIndexGlyph(specs));
  
  // Detail blocks
  const details = renderAllDetailBlocks(specs);
  if (details) {
    sections.push(details);
  }
  
  // Result shapes
  const shapes = renderAllResultShapes();
  if (shapes) {
    sections.push(shapes);
  }
  
  // GLYPH reading guide
  sections.push(`## Reading GLYPH results

Tool results may use GLYPH notation for efficiency:
- \`@tab[cols](rows)\` = table with named columns
- \`@{key:val}\` = object shorthand
- \`["a","b"]\` = row values matching column order`);
  
  return sections.join("\n\n");
}

/**
 * Render tool catalog grouped by category
 * Useful for longer tool lists
 */
export function renderToolCatalogGrouped(): string {
  const specs = getAllToolSpecs();
  
  // Group by category
  const groups: Record<ToolGroup, ToolSpec[]> = {
    Media: [],
    Search: [],
    Code: [],
    Memory: [],
  };
  
  for (const spec of specs) {
    const meta = TOOL_META[spec.name];
    const group = meta?.group ?? "Media";
    groups[group].push(spec);
  }
  
  const sections: string[] = [];
  
  // Header
  sections.push(`# Tools

Call tools using function-calling. Defaults apply if args omitted.`);
  
  // Each group
  for (const [groupName, groupSpecs] of Object.entries(groups)) {
    if (groupSpecs.length === 0) continue;
    
    sections.push(`## ${groupName}\n${renderToolIndexGlyph(groupSpecs)}`);
  }
  
  // Detail blocks
  const details = renderAllDetailBlocks(specs);
  if (details) {
    sections.push(details);
  }
  
  // Result shapes
  const shapes = renderAllResultShapes();
  if (shapes) {
    sections.push(shapes);
  }
  
  // GLYPH reading guide
  sections.push(`## Reading GLYPH results
\`@tab[cols](rows)\` = table, \`@{k:v}\` = object`);
  
  return sections.join("\n\n");
}

export function printCatalog(): void {
  console.log("=== GLYPH TOOL CATALOG ===\n");
  console.log(renderToolCatalogGlyph());
  console.log("\n\n=== GROUPED CATALOG ===\n");
  console.log(renderToolCatalogGrouped());
}
