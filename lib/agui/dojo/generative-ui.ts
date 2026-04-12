/**
 * AG-UI Generative UI System
 * AI-generated interfaces without custom tool renderers
 */

import type { GenerateUIRequest, GeneratedUI, Tool } from "./types";

// =============================================================================
// JSON Schema Types (for form generation)
// =============================================================================

export interface JSONSchema {
  type: "object" | "string" | "number" | "boolean" | "array";
  title?: string;
  description?: string;
  properties?: Record<string, JSONSchema>;
  items?: JSONSchema;
  required?: string[];
  enum?: string[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: "email" | "uri" | "date" | "date-time" | "time";
}

// =============================================================================
// UI Schema Types (for layout)
// =============================================================================

export type UISchemaType = 
  | "VerticalLayout"
  | "HorizontalLayout"
  | "Group"
  | "Control"
  | "Categorization"
  | "Category";

export interface UISchemaElement {
  type: UISchemaType;
  label?: string;
  scope?: string; // JSON Pointer to schema property
  elements?: UISchemaElement[];
  options?: Record<string, unknown>;
}

// =============================================================================
// UI Generator Types
// =============================================================================

export type UIGeneratorType = 
  | "json-forms"      // JSON Forms compatible
  | "react-hook-form" // React Hook Form compatible
  | "html"            // Raw HTML
  | "custom";         // Custom renderer

export interface UIGeneratorConfig {
  type: UIGeneratorType;
  model?: string;
  systemPrompt?: string;
  maxTokens?: number;
}

export interface UIGeneratorResult {
  success: boolean;
  ui?: GeneratedUI;
  error?: string;
  generationType: UIGeneratorType;
}

// =============================================================================
// Generate UI Tool Definition
// =============================================================================

export const generativeUIToolDefinition: Tool = {
  name: "generateUserInterface",
  description: "Generate a dynamic user interface based on a description. Use this to create forms, wizards, or interactive elements.",
  parameters: {
    type: "object",
    properties: {
      description: {
        type: "string",
        description: "A high-level description of the UI (e.g., 'A form for entering the user's shipping address')",
      },
      data: {
        type: "object",
        description: "Pre-populated data for the generated UI",
      },
      output: {
        type: "object",
        description: "A JSON Schema describing the data the agent expects the user to submit",
      },
    },
    required: ["description"],
  },
};

// =============================================================================
// UI Schema Generator
// =============================================================================

/**
 * Generate a JSON Schema from a natural language description
 * This is a simplified implementation - in production, use an LLM
 */
export function generateSchemaFromDescription(description: string): JSONSchema {
  // Simple keyword-based schema generation
  const schema: JSONSchema = {
    type: "object",
    title: extractTitle(description),
    properties: {},
    required: [],
  };
  
  // Common field patterns
  const fieldPatterns: Array<{
    keywords: string[];
    name: string;
    type: JSONSchema["type"];
    format?: string;
  }> = [
    { keywords: ["email", "e-mail"], name: "email", type: "string", format: "email" },
    { keywords: ["name", "full name"], name: "name", type: "string" },
    { keywords: ["first name", "firstname"], name: "firstName", type: "string" },
    { keywords: ["last name", "lastname", "surname"], name: "lastName", type: "string" },
    { keywords: ["address", "street"], name: "street", type: "string" },
    { keywords: ["city"], name: "city", type: "string" },
    { keywords: ["zip", "postal", "postcode"], name: "postalCode", type: "string" },
    { keywords: ["country"], name: "country", type: "string" },
    { keywords: ["phone", "telephone", "mobile"], name: "phone", type: "string" },
    { keywords: ["age"], name: "age", type: "number" },
    { keywords: ["date", "birthday", "dob"], name: "date", type: "string", format: "date" },
    { keywords: ["message", "comment", "description", "notes"], name: "message", type: "string" },
    { keywords: ["agree", "accept", "terms", "consent"], name: "agreed", type: "boolean" },
  ];
  
  const lowerDesc = description.toLowerCase();
  
  for (const pattern of fieldPatterns) {
    if (pattern.keywords.some(kw => lowerDesc.includes(kw))) {
      const prop: JSONSchema = { type: pattern.type };
      if (pattern.format) {
        prop.format = pattern.format as JSONSchema["format"];
      }
      prop.title = capitalizeWords(pattern.name);
      schema.properties![pattern.name] = prop;
      
      // Mark as required if explicitly mentioned
      if (lowerDesc.includes("required") || lowerDesc.includes("mandatory")) {
        schema.required!.push(pattern.name);
      }
    }
  }
  
  return schema;
}

function extractTitle(description: string): string {
  // Try to extract a form title from the description
  const patterns = [
    /form for (.+?)(?:\.|$)/i,
    /(.+?) form/i,
    /^(.+?)$/,
  ];
  
  for (const pattern of patterns) {
    const match = description.match(pattern);
    if (match) {
      return capitalizeWords(match[1].trim());
    }
  }
  
  return "Form";
}

function capitalizeWords(str: string): string {
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

// =============================================================================
// UI Schema Generator
// =============================================================================

/**
 * Generate a UI Schema from a JSON Schema
 */
export function generateUISchema(jsonSchema: JSONSchema): UISchemaElement {
  const elements: UISchemaElement[] = [];
  
  if (jsonSchema.properties) {
    // Group related fields
    const groups: Record<string, string[]> = {
      personal: ["firstName", "lastName", "name", "email", "phone", "age"],
      address: ["street", "city", "postalCode", "country"],
      other: [],
    };
    
    const propertyNames = Object.keys(jsonSchema.properties);
    const grouped = new Set<string>();
    
    // Create groups
    for (const [groupName, fields] of Object.entries(groups)) {
      const groupFields = propertyNames.filter(p => fields.includes(p));
      if (groupFields.length > 0) {
        elements.push({
          type: "Group",
          label: capitalizeWords(groupName) + " Information",
          elements: groupFields.map(field => ({
            type: "Control" as const,
            scope: `#/properties/${field}`,
          })),
        });
        groupFields.forEach(f => grouped.add(f));
      }
    }
    
    // Add ungrouped fields
    const ungrouped = propertyNames.filter(p => !grouped.has(p));
    for (const field of ungrouped) {
      elements.push({
        type: "Control",
        scope: `#/properties/${field}`,
      });
    }
  }
  
  return {
    type: "VerticalLayout",
    elements,
  };
}

// =============================================================================
// Full UI Generator
// =============================================================================

/**
 * Generate complete UI from a request
 */
export function generateUI(request: GenerateUIRequest): GeneratedUI {
  // Generate JSON Schema if not provided
  const jsonSchema = request.output || generateSchemaFromDescription(request.description);
  
  // Generate UI Schema
  const uiSchema = generateUISchema(jsonSchema as JSONSchema);
  
  return {
    jsonSchema: jsonSchema as unknown as Record<string, unknown>,
    uiSchema: uiSchema as unknown as Record<string, unknown>,
    initialData: request.data || {},
  };
}

// =============================================================================
// LLM-Powered UI Generation (Integration Point)
// =============================================================================

/**
 * Generate UI using an LLM (OpenAI-compatible backend)
 * This is the integration point for real LLM-powered generation
 */
export async function generateUIWithLLM(
  request: GenerateUIRequest,
  model?: string
): Promise<GeneratedUI> {
  const systemPrompt = `You are a UI schema generator. Given a description, generate a JSON object with:
1. jsonSchema: A JSON Schema (draft-07) for the form data
2. uiSchema: A JSON Forms UI Schema for layout
3. initialData: Pre-populated values from the provided data

Only output valid JSON. No explanation.`;

  const userPrompt = `Generate a form UI for: ${request.description}
${request.data ? `\nPre-populate with: ${JSON.stringify(request.data)}` : ""}
${request.output ? `\nExpected output schema: ${JSON.stringify(request.output)}` : ""}`;

  try {
    // Dynamic import to avoid circular dependencies
    const { createProviderClient, getProviderConfig, getDefaultModel } = await import("@/lib/llm");
    const { generateText } = await import("ai");
    
    const config = getProviderConfig().primary;
    const client = createProviderClient(config);
    const modelName = model ?? getDefaultModel("primary") ?? "qwen2.5:7b";
    
    const result = await generateText({
      model: client(modelName) as Parameters<typeof generateText>[0]["model"],
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    
    const parsed = JSON.parse(result.text);
    
    return {
      jsonSchema: parsed.jsonSchema || parsed.schema,
      uiSchema: parsed.uiSchema,
      initialData: parsed.initialData || request.data || {},
    };
  } catch (error) {
    console.warn("[GenerativeUI] LLM generation failed, using fallback:", error);
    // Fallback to simple generation
    return generateUI(request);
  }
}

// =============================================================================
// Form Renderer Types
// =============================================================================

export interface FormField {
  name: string;
  label: string;
  type: "text" | "email" | "number" | "date" | "select" | "checkbox" | "textarea";
  required?: boolean;
  options?: string[];
  defaultValue?: unknown;
  validation?: {
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
  };
}

/**
 * Convert JSON Schema to simple form fields
 */
export function schemaToFormFields(schema: JSONSchema): FormField[] {
  const fields: FormField[] = [];
  
  if (!schema.properties) return fields;
  
  for (const [name, prop] of Object.entries(schema.properties)) {
    const field: FormField = {
      name,
      label: prop.title || capitalizeWords(name),
      type: getFieldType(prop),
      required: schema.required?.includes(name),
      defaultValue: prop.default,
    };
    
    if (prop.enum) {
      field.type = "select";
      field.options = prop.enum;
    }
    
    if (prop.minimum !== undefined || prop.maximum !== undefined) {
      field.validation = {
        min: prop.minimum,
        max: prop.maximum,
      };
    }
    
    if (prop.minLength !== undefined || prop.maxLength !== undefined) {
      field.validation = {
        ...field.validation,
        minLength: prop.minLength,
        maxLength: prop.maxLength,
      };
    }
    
    fields.push(field);
  }
  
  return fields;
}

function getFieldType(prop: JSONSchema): FormField["type"] {
  if (prop.type === "boolean") return "checkbox";
  if (prop.type === "number") return "number";
  if (prop.format === "email") return "email";
  if (prop.format === "date" || prop.format === "date-time") return "date";
  if (prop.maxLength && prop.maxLength > 100) return "textarea";
  return "text";
}
