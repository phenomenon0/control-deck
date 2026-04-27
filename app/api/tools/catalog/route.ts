/**
 * GET /api/tools/catalog — bridge tool catalogue for the agent runtime.
 *
 * Returns every tool in BRIDGE_TOOLS (workspace_*, native_*, live.*, vector_*,
 * image/audio/3d/code-exec) with:
 *   - JSON Schema synthesised from the structured TOOL_DEFINITIONS metadata
 *   - the manifest policy facts (risk, sideEffect, allowInVoice, allowInMcp,
 *     requiresApproval, timeoutMs) so callers can drive UI affordances
 *     (eg "voice can't run this") without re-deriving from a private table.
 *
 * `catalogVersion` is a stable hash of the manifest projection — clients
 * cache against it and refresh when it bumps. `?refresh=1` forces a rebuild
 * during dev so manifest edits are picked up without a server restart.
 *
 * Server-side validation still runs in bridgeDispatch via the (richer) Zod
 * schemas. The JSON Schema returned here is "good enough for the LLM tool
 * spec" — type + description + required, plus default-as-text in description.
 */

import { NextResponse, type NextRequest } from "next/server";
import { BRIDGE_TOOLS } from "@/lib/tools/bridgeDispatch";
import { TOOL_DEFINITIONS } from "@/lib/tools/definitions";
import {
  getManifest,
  manifestVersion,
  type RiskLevel,
  type SideEffectKind,
} from "@/lib/tools/manifest";

export const runtime = "nodejs";

interface JsonSchemaProperty {
  type: string;
  description?: string;
  default?: unknown;
}

interface JsonSchemaObject {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties: boolean;
}

interface CatalogTool {
  name: string;
  description: string;
  parameters: JsonSchemaObject;
  policy: {
    risk: RiskLevel;
    sideEffect: SideEffectKind;
    allowInVoice: boolean;
    allowInMcp: boolean;
    requiresApproval: boolean;
    timeoutMs: number;
  };
}

interface CatalogResponse {
  catalogVersion: string;
  tools: CatalogTool[];
}

function paramTypeToJsonType(t: string): string {
  switch (t) {
    case "string":
    case "number":
    case "boolean":
    case "object":
    case "array":
      return t;
    case "int":
    case "integer":
      return "integer";
    default:
      return "string";
  }
}

function buildCatalog(): CatalogResponse {
  const out: CatalogTool[] = [];
  for (const def of TOOL_DEFINITIONS) {
    if (!BRIDGE_TOOLS.has(def.name)) continue;
    const properties: Record<string, JsonSchemaProperty> = {};
    const required: string[] = [];
    for (const p of def.parameters) {
      const prop: JsonSchemaProperty = {
        type: paramTypeToJsonType(p.type),
        description: p.description,
      };
      if (p.default !== undefined) prop.default = p.default;
      properties[p.name] = prop;
      if (p.required) required.push(p.name);
    }
    const manifest = getManifest(def.name);
    out.push({
      name: def.name,
      description: def.description,
      parameters: {
        type: "object",
        properties,
        required: required.length > 0 ? required : undefined,
        additionalProperties: true,
      },
      policy: {
        risk: manifest.risk,
        sideEffect: manifest.sideEffect,
        allowInVoice: manifest.allowInVoice,
        allowInMcp: manifest.allowInMcp,
        requiresApproval: manifest.requiresApproval,
        timeoutMs: manifest.timeoutMs,
      },
    });
  }
  return { catalogVersion: manifestVersion(), tools: out };
}

let cached: CatalogResponse | null = null;

export async function GET(req: NextRequest) {
  const refresh = req.nextUrl.searchParams.get("refresh");
  if (refresh === "1" || !cached) cached = buildCatalog();
  return NextResponse.json(cached);
}
