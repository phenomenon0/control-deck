/**
 * Tool Catalog Renderer
 * Generates GLYPH-formatted tool documentation for LLM context
 */

import { OLLAMA_TOOLS, type OllamaTool } from "./ollama-tools";

// =============================================================================
// Types
// =============================================================================

interface ParamInfo {
  name: string;
  type: string;
  required: boolean;
  description: string;
  default?: string;
  enum?: string[];
  range?: string;
}

interface ToolInfo {
  name: string;
  description: string;
  params: ParamInfo[];
  returns?: string;
}

// =============================================================================
// Parse Tools
// =============================================================================

function parseOllamaTool(tool: OllamaTool): ToolInfo {
  const fn = tool.function;
  const params: ParamInfo[] = [];
  
  for (const [name, prop] of Object.entries(fn.parameters.properties)) {
    const desc = prop.description || "";
    const required = fn.parameters.required.includes(name);
    
    // Extract defaults, ranges, enums from description
    const defaultMatch = desc.match(/default[:\s]+(\S+)/i);
    const rangeMatch = desc.match(/(\d+[-–]\d+)/);
    const enumMatch = desc.match(/:\s*([a-z]+(?:,\s*[a-z]+)+)/i);
    
    params.push({
      name,
      type: prop.type,
      required,
      description: desc.replace(/\s*\([^)]*\)\s*$/, "").replace(/,?\s*default.*$/i, "").trim(),
      default: defaultMatch?.[1],
      range: rangeMatch?.[1],
      enum: enumMatch?.[1]?.split(/,\s*/),
    });
  }
  
  return {
    name: fn.name,
    description: fn.description,
    params,
  };
}

// =============================================================================
// Compact Format (for system prompt)
// =============================================================================

/**
 * Render tool catalog in compact GLYPH format
 * Optimized for minimal tokens while preserving essential info
 */
export function renderToolCatalogCompact(tools: OllamaTool[] = OLLAMA_TOOLS): string {
  const lines: string[] = [];
  
  for (const tool of tools) {
    const info = parseOllamaTool(tool);
    
    // Tool signature: name(required*, optional?)
    const sig = info.params.map(p => {
      const marker = p.required ? "" : "?";
      return `${p.name}${marker}`;
    }).join(" ");
    
    // Short description (first sentence or 60 chars)
    const shortDesc = info.description.split(/[.!]/).shift()?.trim() || info.description;
    const desc = shortDesc.length > 60 ? shortDesc.slice(0, 57) + "..." : shortDesc;
    
    lines.push(`${info.name}(${sig}) - ${desc}`);
  }
  
  return lines.join("\n");
}

/**
 * Render as GLYPH tabular format
 */
export function renderToolCatalogGlyph(tools: OllamaTool[] = OLLAMA_TOOLS): string {
  const rows: string[] = [];
  
  for (const tool of tools) {
    const info = parseOllamaTool(tool);
    
    // Params as compact string: name:type(*|?) 
    const params = info.params.map(p => {
      const req = p.required ? "*" : "?";
      const type = p.type === "string" ? "str" : p.type === "number" ? "num" : p.type === "boolean" ? "bool" : p.type;
      return `${p.name}:${type}${req}`;
    }).join(" ");
    
    // Short description
    const desc = info.description.split(/[.!]/)[0]?.trim() || "";
    
    rows.push(`|${info.name}|${params}|${desc}|`);
  }
  
  return `@tab _ [tool params description]
${rows.join("\n")}
@end`;
}

// =============================================================================
// Verbose Format (full documentation)
// =============================================================================

/**
 * Render tool catalog in verbose GLYPH format
 * Full parameter details, ranges, defaults, enums
 */
export function renderToolCatalogVerbose(tools: OllamaTool[] = OLLAMA_TOOLS): string {
  const sections: string[] = [];
  
  for (const tool of tools) {
    const info = parseOllamaTool(tool);
    
    // Tool header
    let section = `## ${info.name}\n${info.description}\n`;
    
    // Parameters as GLYPH struct
    if (info.params.length > 0) {
      const paramLines: string[] = [];
      
      for (const p of info.params) {
        const parts: string[] = [];
        parts.push(p.required ? "required" : "optional");
        parts.push(p.type);
        if (p.default) parts.push(`default=${p.default}`);
        if (p.range) parts.push(`range=${p.range}`);
        if (p.enum) parts.push(`enum=[${p.enum.join(",")}]`);
        
        paramLines.push(`  ${p.name}: ${parts.join(", ")} - ${p.description}`);
      }
      
      section += "\nParams:\n" + paramLines.join("\n");
    }
    
    sections.push(section);
  }
  
  return sections.join("\n\n---\n\n");
}

// =============================================================================
// Hybrid Format (recommended for system prompt)
// =============================================================================

/**
 * Render tool catalog in hybrid format:
 * - Tabular overview (scannable)
 * - Grouped by category
 * - Key details inline
 */
export function renderToolCatalogHybrid(tools: OllamaTool[] = OLLAMA_TOOLS): string {
  // Group tools by category
  const categories: Record<string, ToolInfo[]> = {
    "media": [],    // image, audio, 3d
    "search": [],   // web, vector
    "code": [],     // execute
    "other": [],
  };
  
  for (const tool of tools) {
    const info = parseOllamaTool(tool);
    const name = info.name;
    
    if (name.includes("image") || name.includes("audio") || name.includes("3d") || name === "glyph_motif") {
      categories.media.push(info);
    } else if (name.includes("search") || name.includes("vector")) {
      categories.search.push(info);
    } else if (name.includes("code") || name.includes("execute")) {
      categories.code.push(info);
    } else {
      categories.other.push(info);
    }
  }
  
  const sections: string[] = [];
  
  // Media tools
  if (categories.media.length > 0) {
    sections.push(renderCategoryGlyph("Media", categories.media));
  }
  
  // Search tools  
  if (categories.search.length > 0) {
    sections.push(renderCategoryGlyph("Search", categories.search));
  }
  
  // Code tools
  if (categories.code.length > 0) {
    sections.push(renderCategoryGlyph("Code", categories.code));
  }
  
  // Other
  if (categories.other.length > 0) {
    sections.push(renderCategoryGlyph("Other", categories.other));
  }
  
  return sections.join("\n\n");
}

function renderCategoryGlyph(category: string, tools: ToolInfo[]): string {
  const rows: string[] = [];
  
  for (const info of tools) {
    // Required params first, then optional
    const required = info.params.filter(p => p.required).map(p => p.name).join(",");
    const optional = info.params.filter(p => !p.required).map(p => p.name).join(",");
    
    // Very short description
    const desc = info.description.split(/[.!]/)[0]?.slice(0, 40) || "";
    
    rows.push(`|${info.name}|${required || "-"}|${optional || "-"}|${desc}|`);
  }
  
  return `[${category}]
@tab _ [tool required optional description]
${rows.join("\n")}
@end`;
}

// =============================================================================
// Export for testing
// =============================================================================

export function printAllFormats(): void {
  console.log("=== COMPACT ===\n");
  console.log(renderToolCatalogCompact());
  
  console.log("\n\n=== GLYPH TABULAR ===\n");
  console.log(renderToolCatalogGlyph());
  
  console.log("\n\n=== HYBRID (Recommended) ===\n");
  console.log(renderToolCatalogHybrid());
  
  console.log("\n\n=== VERBOSE ===\n");
  console.log(renderToolCatalogVerbose());
}
