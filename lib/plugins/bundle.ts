/**
 * Plugin Bundle Parser & Validator
 * 
 * Validates plugin bundles from LLM output and ensures they conform
 * to the expected structure before saving.
 */

import { z } from "zod";
import type { 
  PluginBundle, 
  PluginTemplate, 
  ConfigSchema, 
  DataSource,
  RenderConfig 
} from "./types";
import { TOOL_REGISTRY } from "./registry";

const configFieldSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("string"),
    label: z.string(),
    description: z.string().optional(),
    required: z.boolean().optional(),
    default: z.string().optional(),
    placeholder: z.string().optional(),
    minLength: z.number().optional(),
    maxLength: z.number().optional(),
    pattern: z.string().optional(),
    options: z.array(z.string()).optional(),
  }),
  z.object({
    type: z.literal("number"),
    label: z.string(),
    description: z.string().optional(),
    required: z.boolean().optional(),
    default: z.number().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().optional(),
  }),
  z.object({
    type: z.literal("boolean"),
    label: z.string(),
    description: z.string().optional(),
    required: z.boolean().optional(),
    default: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("array"),
    label: z.string(),
    description: z.string().optional(),
    required: z.boolean().optional(),
    default: z.array(z.string()).optional(),
    itemType: z.enum(["string", "number"]).optional(),
    maxItems: z.number().optional(),
  }),
]);

const configSchemaSchema = z.record(z.string(), configFieldSchema);

const dataSourceSchema = z.object({
  id: z.string().min(1),
  tool: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
  refresh: z.enum(["1m", "5m", "15m", "30m", "1h", "6h", "24h", "manual"]),
  transform: z.string().optional(),
});

const templateSchema = z.enum(["ticker", "feed", "cards", "table", "kv", "form"]);

const manifestSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9_-]+$/, "ID must be lowercase alphanumeric with - or _"),
  name: z.string().min(1).max(50),
  description: z.string().max(200).optional(),
  icon: z.string().optional(),
  author: z.string().optional(),
  version: z.string().optional(),
});

// Template-specific render config schemas
const tickerRenderSchema = z.object({
  type: z.literal("ticker").optional(),
  sources: z.array(z.string()),
  cycle: z.boolean().optional(),
  cycleInterval: z.union([z.number(), z.string()]).optional(),
  textField: z.string().optional(),
  linkField: z.string().optional(),
});

const feedRenderSchema = z.object({
  type: z.literal("feed").optional(),
  source: z.string(),
  maxItems: z.number().optional(),
  titleField: z.string().optional(),
  descriptionField: z.string().optional(),
  linkField: z.string().optional(),
  timeField: z.string().optional(),
  imageField: z.string().optional(),
});

const cardsRenderSchema = z.object({
  type: z.literal("cards").optional(),
  source: z.string(),
  maxCards: z.number().optional(),
  titleField: z.string().optional(),
  subtitleField: z.string().optional(),
  valueField: z.string().optional(),
  iconField: z.string().optional(),
  imageField: z.string().optional(),
  colorField: z.string().optional(),
});

const tableRenderSchema = z.object({
  type: z.literal("table").optional(),
  source: z.string(),
  columns: z.array(z.object({
    key: z.string(),
    label: z.string(),
    width: z.string().optional(),
    align: z.enum(["left", "center", "right"]).optional(),
  })),
  maxRows: z.number().optional(),
  clickable: z.boolean().optional(),
});

const kvRenderSchema = z.object({
  type: z.literal("kv").optional(),
  source: z.string(),
  fields: z.record(z.string(), z.string()),
  layout: z.enum(["vertical", "horizontal"]).optional(),
});

const formRenderSchema = z.object({
  type: z.literal("form").optional(),
  fields: z.array(z.string()),
  submitTool: z.string(),
  submitLabel: z.string().optional(),
  resultDisplay: z.enum(["text", "json", "table"]).optional(),
});

const pluginBundleSchema = z.object({
  version: z.literal(1),
  type: z.literal("widget"),
  manifest: manifestSchema,
  template: templateSchema,
  config: z.object({
    schema: configSchemaSchema,
    defaults: z.record(z.string(), z.unknown()).optional(),
  }),
  sources: z.array(dataSourceSchema),
  render: z.union([
    tickerRenderSchema,
    feedRenderSchema,
    cardsRenderSchema,
    tableRenderSchema,
    kvRenderSchema,
    formRenderSchema,
  ]),
});

export interface ValidationResult {
  valid: boolean;
  bundle?: PluginBundle;
  errors: string[];
  warnings: string[];
}

/**
 * Parse and validate a plugin bundle
 */
export function parseBundle(input: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // First, validate the structure with Zod
  const parseResult = pluginBundleSchema.safeParse(input);
  
  if (!parseResult.success) {
    for (const issue of parseResult.error.issues) {
      errors.push(`${issue.path.join(".")}: ${issue.message}`);
    }
    return { valid: false, errors, warnings };
  }

  const bundle = parseResult.data as PluginBundle;

  // Validate tools exist in registry
  for (const source of bundle.sources) {
    if (!TOOL_REGISTRY[source.tool]) {
      errors.push(`Unknown tool "${source.tool}" in source "${source.id}". Available tools: ${Object.keys(TOOL_REGISTRY).join(", ")}`);
    }
  }

  // Validate source references in render config
  const sourceIds = new Set(bundle.sources.map(s => s.id));
  
  if ("sources" in bundle.render) {
    for (const sourceRef of bundle.render.sources) {
      if (!sourceIds.has(sourceRef)) {
        errors.push(`Render config references unknown source "${sourceRef}"`);
      }
    }
  }
  
  if ("source" in bundle.render && bundle.render.source) {
    if (!sourceIds.has(bundle.render.source)) {
      errors.push(`Render config references unknown source "${bundle.render.source}"`);
    }
  }

  // Validate config references in source args
  const configKeys = new Set(Object.keys(bundle.config.schema));
  const configRefPattern = /\{\{config\.([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;
  
  for (const source of bundle.sources) {
    const argsStr = JSON.stringify(source.args);
    let match;
    while ((match = configRefPattern.exec(argsStr)) !== null) {
      if (!configKeys.has(match[1])) {
        errors.push(`Source "${source.id}" references unknown config field "{{config.${match[1]}}}"`);
      }
    }
  }

  // Warnings for best practices
  if (!bundle.manifest.description) {
    warnings.push("Plugin has no description");
  }
  
  if (bundle.sources.length === 0) {
    warnings.push("Plugin has no data sources");
  }

  // Check for duplicate source IDs
  const seenSourceIds = new Set<string>();
  for (const source of bundle.sources) {
    if (seenSourceIds.has(source.id)) {
      errors.push(`Duplicate source ID "${source.id}"`);
    }
    seenSourceIds.add(source.id);
  }

  return {
    valid: errors.length === 0,
    bundle: errors.length === 0 ? bundle : undefined,
    errors,
    warnings,
  };
}

/**
 * Parse bundle from JSON string
 */
export function parseBundleFromJson(json: string): ValidationResult {
  try {
    const parsed = JSON.parse(json);
    return parseBundle(parsed);
  } catch (e) {
    return {
      valid: false,
      errors: [`Invalid JSON: ${e instanceof Error ? e.message : "Parse error"}`],
      warnings: [],
    };
  }
}

/**
 * Extract JSON bundle from LLM response text
 * Handles markdown code blocks and plain JSON
 */
export function extractBundleFromText(text: string): ValidationResult {
  // Try to find JSON in code block first
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    return parseBundleFromJson(codeBlockMatch[1].trim());
  }

  // Try to find raw JSON object
  const jsonMatch = text.match(/\{[\s\S]*"version"\s*:\s*1[\s\S]*"type"\s*:\s*"widget"[\s\S]*\}/);
  if (jsonMatch) {
    return parseBundleFromJson(jsonMatch[0]);
  }

  return {
    valid: false,
    errors: ["Could not find a valid plugin bundle in the response"],
    warnings: [],
  };
}

/**
 * Interpolate config values into a string
 * Replaces {{config.fieldName}} with actual values
 */
export function interpolateConfigValue(
  template: string,
  configValues: Record<string, unknown>
): string {
  return template.replace(
    /\{\{config\.([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g,
    (_, key) => {
      const value = configValues[key];
      return value !== undefined ? String(value) : "";
    }
  );
}

/**
 * Interpolate config values in an object (deep)
 */
export function interpolateConfig(
  obj: unknown,
  configValues: Record<string, unknown>
): unknown {
  if (typeof obj === "string") {
    return interpolateConfigValue(obj, configValues);
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => interpolateConfig(item, configValues));
  }
  
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = interpolateConfig(value, configValues);
    }
    return result;
  }
  
  return obj;
}

/**
 * Get default config values from schema
 */
export function getDefaultConfigValues(schema: ConfigSchema): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  
  for (const [key, field] of Object.entries(schema)) {
    if ("default" in field && field.default !== undefined) {
      defaults[key] = field.default;
    }
  }
  
  return defaults;
}

/**
 * Merge user config with defaults
 */
export function mergeConfigValues(
  schema: ConfigSchema,
  bundleDefaults: Record<string, unknown> | undefined,
  userValues: Record<string, unknown>
): Record<string, unknown> {
  const schemaDefaults = getDefaultConfigValues(schema);
  return {
    ...schemaDefaults,
    ...bundleDefaults,
    ...userValues,
  };
}
