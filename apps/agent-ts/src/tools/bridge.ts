/**
 * Bridge tools — HTTP-POST callbacks to Control-Deck's `/api/tools/bridge`.
 *
 * Mirrors the bridge tool list in Agent-GO (`core/llm_client.go`):
 *   generate_image, edit_image, generate_audio, analyze_image, execute_code,
 *   image_to_3d, glyph_motif.
 *
 * Each tool's `parameters` schema matches the JSON Schema Agent-GO ships to
 * the LLM. The actual server-side validation (Zod) lives in
 * `lib/tools/bridgeDispatch.ts`; we just pass args through.
 */

import { Type, type Static, type TSchema } from "typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";

interface BridgeArtifact {
  id: string;
  url: string;
  name: string;
  mimeType: string;
}

interface BridgeResponse {
  success: boolean;
  message?: string;
  artifacts?: BridgeArtifact[];
  data?: unknown;
  error?: string;
}

export interface BridgeContext {
  bridgeUrl: string;
  threadId: string;
  runId: string;
}

type AnyTool = AgentTool<any, any>;

interface BridgeToolDef {
  name: string;
  label: string;
  description: string;
  schema: TSchema;
}

const BRIDGE_TOOL_DEFS: BridgeToolDef[] = [
  {
    name: "generate_image",
    label: "Generate image",
    description: "Generate an image from a text prompt.",
    schema: Type.Object({
      prompt: Type.String({ description: "Text description of the image to generate." }),
      width: Type.Optional(Type.Integer({ description: "Image width in pixels (default 512).", default: 512 })),
      height: Type.Optional(Type.Integer({ description: "Image height in pixels (default 512).", default: 512 })),
      seed: Type.Optional(Type.Integer({ description: "Random seed for reproducibility." })),
    }),
  },
  {
    name: "edit_image",
    label: "Edit image",
    description: "Edit an existing image based on a natural-language instruction.",
    schema: Type.Object({
      image_id: Type.String({ description: "ID of the uploaded image to edit." }),
      instruction: Type.String({ description: "Edit instruction." }),
      seed: Type.Optional(Type.Integer({ description: "Random seed for reproducibility." })),
    }),
  },
  {
    name: "generate_audio",
    label: "Generate audio",
    description: "Generate audio from a text prompt.",
    schema: Type.Object({
      prompt: Type.String({ description: "Text description of the audio to generate." }),
      duration: Type.Optional(Type.Integer({ description: "Duration seconds (default 10, max 30).", default: 10 })),
      seed: Type.Optional(Type.Integer({ description: "Random seed for reproducibility." })),
    }),
  },
  {
    name: "analyze_image",
    label: "Analyze image",
    description: "Analyze an image and answer questions about it.",
    schema: Type.Object({
      image_id: Type.String({ description: "ID of the uploaded image to analyze." }),
      question: Type.Optional(
        Type.String({ description: "Question to answer (default: describe the image)." }),
      ),
    }),
  },
  {
    name: "image_to_3d",
    label: "Image → 3D",
    description: "Convert a 2D image into a 3D mesh.",
    schema: Type.Object({
      image_id: Type.String({ description: "ID of the uploaded image to convert." }),
      seed: Type.Optional(Type.Integer({ description: "Random seed for reproducibility." })),
    }),
  },
  {
    name: "glyph_motif",
    label: "Glyph motif",
    description: "Render a procedural glyph motif from a textual seed.",
    schema: Type.Object({
      prompt: Type.String({ description: "Glyph motif prompt." }),
      seed: Type.Optional(Type.Integer({ description: "Random seed." })),
    }),
  },
  {
    name: "execute_code",
    label: "Execute code",
    description: "Execute code in a sandboxed environment (python, javascript, typescript, go, rust, bash).",
    schema: Type.Object({
      language: Type.String({ description: "Programming language." }),
      code: Type.String({ description: "Source code to execute." }),
      timeout: Type.Optional(
        Type.Integer({ description: "Timeout in milliseconds (default 30000).", default: 30000 }),
      ),
    }),
  },
];

export function bridgeTools(ctx: BridgeContext): AnyTool[] {
  return BRIDGE_TOOL_DEFS.map((def) => buildBridgeTool(def, ctx) as AnyTool);
}

function buildBridgeTool(def: BridgeToolDef, ctx: BridgeContext) {
  const schema = def.schema;
  return {
    name: def.name,
    label: def.label,
    description: def.description,
    parameters: schema,
    async execute(
      toolCallId: string,
      args: Static<typeof schema>,
      signal?: AbortSignal,
    ): Promise<AgentToolResult<unknown>> {
      const body = {
        tool: def.name,
        args,
        ctx: {
          thread_id: ctx.threadId,
          run_id: ctx.runId,
          tool_call_id: toolCallId,
        },
      };

      let res: Response;
      try {
        res = await fetch(ctx.bridgeUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`bridge request failed (${def.name}): ${msg}`);
      }

      const text = await res.text();
      let parsed: BridgeResponse;
      try {
        parsed = JSON.parse(text) as BridgeResponse;
      } catch {
        throw new Error(`bridge ${def.name} returned non-JSON (status ${res.status}): ${text.slice(0, 200)}`);
      }

      if (!res.ok || !parsed.success) {
        const reason = parsed.error || `HTTP ${res.status}`;
        throw new Error(`bridge ${def.name} failed: ${reason}`);
      }

      const lines: string[] = [];
      if (parsed.message) lines.push(parsed.message);
      if (parsed.artifacts?.length) {
        lines.push("");
        lines.push("Artifacts created:");
        for (const art of parsed.artifacts) {
          lines.push(`- ${art.name} (${art.mimeType}): ${art.url}`);
        }
      }
      const out = lines.join("\n").trim() || `(${def.name} returned no message)`;

      return {
        content: [{ type: "text", text: out }],
        details: {
          tool: def.name,
          artifacts: parsed.artifacts ?? [],
          data: parsed.data,
        },
      };
    },
  };
}
