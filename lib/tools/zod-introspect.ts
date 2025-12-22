/**
 * Zod Schema Introspection
 * 
 * Extracts structured metadata from Zod schemas for:
 * - GLYPH catalog generation (LLM docs)
 * - OpenAI/Ollama tool definitions
 * - UI form generation
 * 
 * This is the SINGLE SOURCE OF TRUTH extractor.
 * All other representations are derived from ToolSpec[].
 * 
 * Compatible with Zod v4.x internal structure.
 */

import { z } from "zod";

// =============================================================================
// Types - Intermediate Representation
// =============================================================================

export type FieldType = "str" | "num" | "bool" | "enum" | "obj" | "arr" | "any";

export interface FieldSpec {
  name: string;
  type: FieldType;
  required: boolean;
  description?: string;
  default?: unknown;
  enumValues?: string[];
  min?: number;
  max?: number;
  /** For arrays: the element type */
  elementType?: FieldType;
  /** For objects: nested field specs */
  nested?: FieldSpec[];
}

export interface ToolSpec {
  name: string;
  description: string;
  params: FieldSpec[];
}

// =============================================================================
// Zod Type Detection (v4 compatible)
// =============================================================================

/**
 * Get the type string from a Zod schema def
 * Zod v4 uses def.type as a string
 */
function getZodType(schema: z.ZodType): string {
  const def = schema._def as unknown as Record<string, unknown>;
  
  // v4 style: def.type is a string
  if (typeof def.type === "string") {
    return def.type;
  }
  
  // v3 style: def.typeName
  if (typeof def.typeName === "string") {
    return def.typeName.replace("Zod", "").toLowerCase();
  }
  
  return "unknown";
}

/**
 * Get inner type from wrapper schemas (default, optional, nullable)
 */
function getInnerType(schema: z.ZodType): z.ZodType | null {
  const def = schema._def as unknown as Record<string, unknown>;
  
  if (def.innerType && typeof def.innerType === "object" && "_def" in (def.innerType as object)) {
    return def.innerType as z.ZodType;
  }
  
  return null;
}

/**
 * Get default value from a default schema
 */
function getDefaultValue(schema: z.ZodType): unknown {
  const def = schema._def as unknown as Record<string, unknown>;
  
  // v4: defaultValue is just a value
  if ("defaultValue" in def) {
    const dv = def.defaultValue;
    // Could be a function (v3) or a value (v4)
    return typeof dv === "function" ? dv() : dv;
  }
  
  return undefined;
}

/**
 * Unwrap optional/default/nullable wrappers to get the inner type
 * Returns: [innerSchema, isRequired, defaultValue]
 */
function unwrapZodType(schema: z.ZodType): [z.ZodType, boolean, unknown] {
  const type = getZodType(schema);
  const inner = getInnerType(schema);
  
  // default wraps a type with a default value
  if (type === "default" && inner) {
    const defaultVal = getDefaultValue(schema);
    const [deepInner, , ] = unwrapZodType(inner);
    return [deepInner, false, defaultVal]; // has default = not required
  }
  
  // optional makes a field optional
  if (type === "optional" && inner) {
    const [deepInner, , defVal] = unwrapZodType(inner);
    return [deepInner, false, defVal];
  }
  
  // nullable allows null
  if (type === "nullable" && inner) {
    const [deepInner, req, defVal] = unwrapZodType(inner);
    return [deepInner, req, defVal];
  }
  
  // Base case: not wrapped
  return [schema, true, undefined];
}

/**
 * Map Zod type string to our simplified FieldType
 */
function mapZodTypeToFieldType(zodType: string): FieldType {
  switch (zodType.toLowerCase()) {
    case "string":
    case "zodstring":
      return "str";
    case "number":
    case "zodnumber":
      return "num";
    case "boolean":
    case "zodboolean":
      return "bool";
    case "enum":
    case "zodenum":
    case "nativeenum":
    case "zodnativeenum":
      return "enum";
    case "array":
    case "zodarray":
      return "arr";
    case "object":
    case "zodobject":
    case "record":
    case "zodrecord":
      return "obj";
    default:
      return "any";
  }
}

/**
 * Extract min/max constraints from a number schema
 */
function extractNumberConstraints(schema: z.ZodType): { min?: number; max?: number } {
  const def = schema._def as unknown as Record<string, unknown>;
  const schemaAny = schema as unknown as Record<string, unknown>;
  const result: { min?: number; max?: number } = {};
  
  // v4 style: minValue/maxValue directly on the schema object (not just _def)
  // Filter out safe integer bounds which are the defaults
  const safeMin = Number.MIN_SAFE_INTEGER;
  const safeMax = Number.MAX_SAFE_INTEGER;
  
  // Check schema object first (Zod v4)
  if (typeof schemaAny.minValue === "number" && schemaAny.minValue !== safeMin && schemaAny.minValue > -1e15) {
    result.min = schemaAny.minValue;
  }
  if (typeof schemaAny.maxValue === "number" && schemaAny.maxValue !== safeMax && schemaAny.maxValue < 1e15) {
    result.max = schemaAny.maxValue;
  }
  
  // Also check _def for v3 compatibility
  if (result.min === undefined && typeof def.minValue === "number" && def.minValue !== safeMin && (def.minValue as number) > -1e15) {
    result.min = def.minValue as number;
  }
  if (result.max === undefined && typeof def.maxValue === "number" && def.maxValue !== safeMax && (def.maxValue as number) < 1e15) {
    result.max = def.maxValue as number;
  }
  
  // v3 style: checks array
  const checks = def.checks as Array<{ kind: string; value?: number }> | undefined;
  if (checks) {
    for (const check of checks) {
      if (check.kind === "min" && typeof check.value === "number") {
        result.min = check.value;
      }
      if (check.kind === "max" && typeof check.value === "number") {
        result.max = check.value;
      }
    }
  }
  
  return result;
}

/**
 * Extract enum values from an enum schema
 */
function extractEnumValues(schema: z.ZodType): string[] | undefined {
  const def = schema._def as unknown as Record<string, unknown>;
  
  // v4 style: entries is Map or array-like
  if (def.entries && typeof def.entries === "object") {
    const entries = def.entries as Map<string, unknown> | Record<string, unknown>;
    if (entries instanceof Map) {
      return Array.from(entries.keys());
    }
    return Object.keys(entries);
  }
  
  // v3 style: values array
  if (def.values && Array.isArray(def.values)) {
    return [...def.values];
  }
  
  return undefined;
}

/**
 * Extract description from schema
 */
function extractDescription(schema: z.ZodType): string | undefined {
  // Try schema.description (v3/v4)
  if ("description" in schema && typeof schema.description === "string") {
    return schema.description;
  }
  
  // Try _def.description
  const def = schema._def as unknown as Record<string, unknown>;
  if (typeof def.description === "string") {
    return def.description;
  }
  
  return undefined;
}

// =============================================================================
// Main Extraction
// =============================================================================

/**
 * Extract FieldSpec from a single Zod field
 */
export function extractFieldSpec(name: string, schema: z.ZodType): FieldSpec {
  const [innerSchema, required, defaultValue] = unwrapZodType(schema);
  const zodType = getZodType(innerSchema);
  const type = mapZodTypeToFieldType(zodType);
  
  const spec: FieldSpec = {
    name,
    type,
    required,
  };
  
  // Description (from outer schema, as that's where .describe() attaches)
  const desc = extractDescription(schema) || extractDescription(innerSchema);
  if (desc) spec.description = desc;
  
  // Default value
  if (defaultValue !== undefined) {
    spec.default = defaultValue;
  }
  
  // Enum values
  if (type === "enum") {
    spec.enumValues = extractEnumValues(innerSchema);
  }
  
  // Number constraints
  if (type === "num") {
    const { min, max } = extractNumberConstraints(innerSchema);
    if (min !== undefined) spec.min = min;
    if (max !== undefined) spec.max = max;
  }
  
  // Array element type
  if (type === "arr") {
    const def = innerSchema._def as unknown as Record<string, unknown>;
    if (def.element && typeof def.element === "object" && "_def" in (def.element as object)) {
      const elementType = getZodType(def.element as z.ZodType);
      spec.elementType = mapZodTypeToFieldType(elementType);
    }
  }
  
  // Object nested fields
  if (type === "obj" && "shape" in innerSchema) {
    const shape = (innerSchema as z.ZodObject<z.ZodRawShape>).shape;
    spec.nested = Object.entries(shape).map(([k, v]) => 
      extractFieldSpec(k, v as z.ZodType)
    );
  }
  
  return spec;
}

/**
 * Extract ToolSpec from a tool schema (ZodObject with name literal + args object)
 * 
 * Expected shape:
 * z.object({
 *   name: z.literal("tool_name"),
 *   args: z.object({ ... })
 * })
 */
export function extractToolSpec(toolSchema: z.ZodObject<z.ZodRawShape>): ToolSpec {
  const shape = toolSchema.shape;
  
  // Extract tool name from z.literal
  const nameSchema = shape.name as z.ZodType;
  const nameDef = nameSchema._def as unknown as Record<string, unknown>;
  const nameType = getZodType(nameSchema);
  
  if (nameType !== "literal") {
    throw new Error(`Tool schema must have z.literal name, got ${nameType}`);
  }
  
  // v4: values is an array, v3: value is the literal
  const name = (nameDef.values as string[])?.[0] ?? nameDef.value as string;
  if (!name) {
    throw new Error("Could not extract tool name from literal");
  }
  
  // Extract description - check multiple places
  let description = extractDescription(toolSchema) || "";
  
  // If no description on schema, try to get from args or construct from name
  if (!description) {
    // Check if there's a description in the name's def (some patterns store it there)
    description = extractDescription(nameSchema) || "";
  }
  
  // Extract params from args object
  const argsSchema = shape.args as z.ZodObject<z.ZodRawShape>;
  const argsShape = argsSchema.shape;
  
  const params = Object.entries(argsShape).map(([paramName, paramSchema]) =>
    extractFieldSpec(paramName, paramSchema as z.ZodType)
  );
  
  return { name, description, params };
}

/**
 * Extract all ToolSpecs from an array of tool schemas
 */
export function extractAllToolSpecs(schemas: z.ZodObject<z.ZodRawShape>[]): ToolSpec[] {
  return schemas.map(extractToolSpec);
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Check if a tool has "complex" params (enums, ranges, nested objects)
 * Used to decide whether to generate detail blocks
 */
export function hasComplexParams(spec: ToolSpec): boolean {
  return spec.params.some(p => 
    p.enumValues !== undefined ||
    p.min !== undefined ||
    p.max !== undefined ||
    p.nested !== undefined
  );
}

/**
 * Get required params
 */
export function getRequiredParams(spec: ToolSpec): FieldSpec[] {
  return spec.params.filter(p => p.required);
}

/**
 * Get optional params
 */
export function getOptionalParams(spec: ToolSpec): FieldSpec[] {
  return spec.params.filter(p => !p.required);
}

/**
 * Format field type with optional default for display
 * e.g., "num=768" or "str" or "enum=sigil"
 */
export function formatFieldType(spec: FieldSpec, includeDefault = true): string {
  let result: string = spec.type;
  
  if (spec.enumValues && spec.enumValues.length <= 3) {
    // Short enums inline
    result = spec.enumValues.join("|");
  }
  
  if (includeDefault && spec.default !== undefined) {
    result += `=${spec.default}`;
  }
  
  return result;
}

/**
 * Format field for GLYPH column: "name:type" or "name:type=default"
 */
export function formatFieldGlyph(spec: FieldSpec, includeDefault = true): string {
  const type = formatFieldType(spec, includeDefault);
  return `${spec.name}:${type}`;
}
