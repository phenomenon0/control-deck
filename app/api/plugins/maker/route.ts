/**
 * Plugin Maker API
 * 
 * Uses LLM to generate plugin bundles from user descriptions.
 * 
 * Endpoints:
 * - POST /api/plugins/maker - Generate a plugin bundle from description
 * - POST /api/plugins/maker?action=refine - Refine an existing bundle
 */

import { NextRequest, NextResponse } from "next/server";
import { streamText, generateText } from "ai";
import { createProviderClient, getProviderConfig, getDefaultModel } from "@/lib/llm/providers";
import { listTools } from "@/lib/plugins/registry";
import { extractBundleFromText, parseBundle } from "@/lib/plugins/bundle";
import type { PluginBundle, PluginTemplate } from "@/lib/plugins/types";

// =============================================================================
// System Prompt for Bundle Generation
// =============================================================================

function getSystemPrompt(): string {
  const tools = listTools();
  const toolDocs = tools.map(t => 
    `- ${t.id}: ${t.description}\n  Input: ${JSON.stringify(t.inputSchema, null, 2).split('\n').join('\n  ')}`
  ).join('\n\n');

  return `You are a plugin bundle generator for Control Deck, an AI control center.
Your job is to create JSON plugin bundles based on user descriptions.

## Available Templates

1. **ticker** - Rotating single-line items (scores, headlines, alerts)
   - Best for: Live scores, breaking news, status updates
   - Render config: { sources: string[], cycle?: boolean, cycleInterval?: number }

2. **feed** - Scrollable list of items with optional images
   - Best for: News feeds, RSS readers, notification lists
   - Render config: { source: string, maxItems?: number, titleField?, descriptionField?, linkField?, timeField?, imageField? }

3. **cards** - Visual cards with icons/images in grid layout
   - Best for: Stats dashboards, category displays, quick actions
   - Render config: { source: string, maxCards?: number, titleField?, subtitleField?, valueField?, iconField?, imageField?, colorField? }

4. **table** - Sortable data grid
   - Best for: Structured data, rankings, comparison views
   - Render config: { source: string, columns: [{key, label, width?, align?}], maxRows?, clickable? }

5. **kv** - Key-value pairs display
   - Best for: Status info, settings display, metrics
   - Render config: { source: string, fields: {fieldKey: "Display Label"}, layout?: "vertical"|"horizontal" }

6. **form** - Input form with submit action
   - Best for: Search widgets, quick entry, settings forms
   - Render config: { fields: string[], submitTool: string, submitLabel?, resultDisplay?: "text"|"json"|"table" }

## Available Tools

${toolDocs}

## Bundle Format

\`\`\`json
{
  "version": 1,
  "type": "widget",
  "manifest": {
    "id": "snake_case_id",
    "name": "Display Name",
    "description": "Short description",
    "icon": "lucide-icon-name"
  },
  "template": "ticker|feed|cards|table|kv|form",
  "config": {
    "schema": {
      "fieldName": {
        "type": "string|number|boolean|array",
        "label": "Field Label",
        "description": "Optional help text",
        "default": "default value",
        "required": true|false,
        "options": ["for", "select", "dropdowns"],
        "min": 0, "max": 100, "step": 1
      }
    },
    "defaults": {}
  },
  "sources": [
    {
      "id": "source_id",
      "tool": "tool.name",
      "args": { "arg": "{{config.fieldName}}" },
      "refresh": "1m|5m|15m|30m|1h|6h|24h|manual"
    }
  ],
  "render": {
    // Template-specific config (see above)
  }
}
\`\`\`

## Config Interpolation

Use \`{{config.fieldName}}\` in source args to reference user config values.

## Guidelines

1. Always use valid tool IDs from the Available Tools list above
2. Use descriptive manifest.id in snake_case
3. Choose appropriate refresh intervals (don't poll too frequently)
4. Include helpful config field descriptions
5. Match template choice to data type (ticker for rotating text, feed for lists, etc.)
6. Use Lucide icon names (trophy, newspaper, rss, cloud, github, search, etc.)

## Response Format

Always respond with ONLY a valid JSON bundle inside a markdown code block.
Do not include explanatory text before or after the JSON.

\`\`\`json
{ ... your bundle ... }
\`\`\``;
}

// =============================================================================
// Refinement Prompt
// =============================================================================

function getRefinementPrompt(bundle: PluginBundle, feedback: string): string {
  return `The user wants to modify this existing plugin bundle:

Current Bundle:
\`\`\`json
${JSON.stringify(bundle, null, 2)}
\`\`\`

User Feedback:
${feedback}

Generate an updated bundle that addresses the feedback while maintaining valid structure.
Respond with ONLY the complete updated JSON bundle in a code block.`;
}

// =============================================================================
// POST - Generate or refine a plugin bundle
// =============================================================================

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action");
    const body = await req.json();
    
    // Check if this is a refinement request
    if (action === "refine") {
      return handleRefine(body);
    }
    
    // Otherwise, generate new bundle
    return handleGenerate(body);
  } catch (error) {
    console.error("POST /api/plugins/maker error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Bundle generation failed" },
      { status: 500 }
    );
  }
}

// =============================================================================
// Generate new bundle
// =============================================================================

async function handleGenerate(body: { description: string; template?: PluginTemplate; hints?: Record<string, unknown> }) {
  const { description, template, hints } = body;
  
  if (!description) {
    return NextResponse.json(
      { error: "Missing description" },
      { status: 400 }
    );
  }
  
  // Build user prompt
  let userPrompt = `Create a plugin widget for: ${description}`;
  
  if (template) {
    userPrompt += `\n\nUse the "${template}" template.`;
  }
  
  if (hints) {
    userPrompt += `\n\nAdditional hints:\n${JSON.stringify(hints, null, 2)}`;
  }
  
  // Get the model
  const config = getProviderConfig().primary;
  const client = createProviderClient(config);
  const modelName = config.model || getDefaultModel("primary") || "llama3.2";
  
  // Generate the bundle
  const result = await generateText({
    model: client(modelName) as Parameters<typeof generateText>[0]["model"],
    system: getSystemPrompt(),
    messages: [{ role: "user", content: userPrompt }],
  });
  
  const fullText = result.text;
  
  // Extract and validate the bundle
  const extracted = extractBundleFromText(fullText);
  
  if (!extracted.valid || !extracted.bundle) {
    return NextResponse.json(
      {
        error: "Failed to generate valid bundle",
        validationErrors: extracted.errors,
        rawResponse: fullText,
      },
      { status: 422 }
    );
  }
  
  return NextResponse.json({
    bundle: extracted.bundle,
    warnings: extracted.warnings,
    provider: config.provider,
    model: config.model,
  });
}

// =============================================================================
// Refine existing bundle
// =============================================================================

async function handleRefine(body: { bundle: PluginBundle | string; feedback: string }) {
  const { bundle: bundleInput, feedback } = body;
  
  if (!bundleInput || !feedback) {
    return NextResponse.json(
      { error: "Missing bundle or feedback" },
      { status: 400 }
    );
  }
  
  // Parse bundle if it's a string
  let bundle: PluginBundle;
  if (typeof bundleInput === "string") {
    try {
      bundle = JSON.parse(bundleInput);
    } catch {
      return NextResponse.json(
        { error: "Invalid bundle JSON" },
        { status: 400 }
      );
    }
  } else {
    bundle = bundleInput;
  }
  
  // Validate the existing bundle
  const validation = parseBundle(bundle);
  if (!validation.valid) {
    return NextResponse.json(
      { error: "Input bundle is invalid", validationErrors: validation.errors },
      { status: 400 }
    );
  }
  
  // Get the model
  const config = getProviderConfig().primary;
  const client = createProviderClient(config);
  const modelName = config.model || getDefaultModel("primary") || "llama3.2";
  
  // Generate refined bundle
  const result = await generateText({
    model: client(modelName) as Parameters<typeof generateText>[0]["model"],
    system: getSystemPrompt(),
    messages: [{ role: "user", content: getRefinementPrompt(bundle, feedback) }],
  });
  
  const fullText = result.text;
  
  // Extract and validate the bundle
  const extracted = extractBundleFromText(fullText);
  
  if (!extracted.valid || !extracted.bundle) {
    return NextResponse.json(
      {
        error: "Failed to generate valid refined bundle",
        validationErrors: extracted.errors,
        rawResponse: fullText,
      },
      { status: 422 }
    );
  }
  
  return NextResponse.json({
    bundle: extracted.bundle,
    warnings: extracted.warnings,
    provider: config.provider,
    model: config.model,
  });
}

// =============================================================================
// GET - Get available tools and templates for the maker UI
// =============================================================================

export async function GET() {
  const tools = listTools();
  
  const templates: Array<{
    id: PluginTemplate;
    name: string;
    description: string;
    icon: string;
  }> = [
    { id: "ticker", name: "Ticker", description: "Rotating single-line items", icon: "radio" },
    { id: "feed", name: "Feed", description: "Scrollable list with images", icon: "list" },
    { id: "cards", name: "Cards", description: "Visual cards in grid layout", icon: "layout-grid" },
    { id: "table", name: "Table", description: "Sortable data grid", icon: "table" },
    { id: "kv", name: "Key-Value", description: "Labeled pairs display", icon: "file-text" },
    { id: "form", name: "Form", description: "Input form with action", icon: "square-pen" },
  ];
  
  return NextResponse.json({
    tools: tools.map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
    })),
    templates,
  });
}
