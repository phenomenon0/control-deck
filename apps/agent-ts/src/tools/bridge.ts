/**
 * Bridge tools — HTTP-POST callbacks to Control-Deck's `/api/tools/bridge`.
 *
 * The catalogue is discovered at run start from `/api/tools/catalog` so the
 * agent automatically picks up workspace_*, native_*, live.*, vector_*, plus
 * the original media/code-exec set without redeploying agent-ts. Each tool's
 * `parameters` is the JSON Schema returned by the catalogue (cast to TSchema —
 * pi-ai forwards parameters opaquely to the LLM tool spec).
 *
 * The dispatch contract is unchanged: POST {tool, args, ctx} → JSON response
 * with success/message/artifacts/data. bridgeDispatch on the deck side runs
 * the canonical Zod validation.
 */

import type { TSchema, Static } from "typebox";
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

interface CatalogTool {
  name: string;
  description: string;
  parameters: unknown;
}

interface CatalogResponse {
  tools?: CatalogTool[];
}

export interface BridgeContext {
  /** Absolute URL of /api/tools/bridge (with bridge_token if needed). */
  bridgeUrl: string;
  /** Absolute URL of /api/tools/catalog (auth via DECK_TOKEN header/query). */
  catalogUrl?: string;
  threadId: string;
  runId: string;
}

type AnyTool = AgentTool<TSchema, unknown>;

const FALLBACK_SCHEMA: TSchema = {
  type: "object",
  properties: {},
  additionalProperties: true,
} as unknown as TSchema;

/**
 * Build the catalog URL from a known bridge URL by swapping the path.
 * Lets callers pass only a bridge URL and still get a working catalog probe.
 * Keeps `bridge_token` so middleware can reuse it as a catalog credential.
 */
export function deriveCatalogUrl(bridgeUrl: string): string {
  try {
    const u = new URL(bridgeUrl);
    u.pathname = "/api/tools/catalog";
    return u.toString();
  } catch {
    return bridgeUrl;
  }
}

/**
 * Build the preflight URL by swapping the bridge path. The deck owns the
 * canonical "may this tool run?" decision; agent-ts asks before executing.
 */
export function derivePreflightUrl(bridgeUrl: string): string {
  try {
    const u = new URL(bridgeUrl);
    u.pathname = "/api/tools/preflight";
    return u.toString();
  } catch {
    return bridgeUrl;
  }
}

export async function bridgeTools(ctx: BridgeContext): Promise<AnyTool[]> {
  const catalogUrl = ctx.catalogUrl ?? deriveCatalogUrl(ctx.bridgeUrl);
  let res: Response;
  try {
    res = await fetch(catalogUrl, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[agent-ts] bridge catalog fetch failed: ${msg}`);
    return [];
  }
  if (!res.ok) {
    console.warn(`[agent-ts] bridge catalog returned ${res.status}`);
    return [];
  }
  const data = (await res.json().catch(() => ({}))) as CatalogResponse;
  const tools = data.tools ?? [];
  return tools.map((t) => buildBridgeTool(t, ctx));
}

function buildBridgeTool(meta: CatalogTool, ctx: BridgeContext): AnyTool {
  const parameters = (meta.parameters as TSchema | undefined) ?? FALLBACK_SCHEMA;
  return {
    name: meta.name,
    label: meta.name,
    description: meta.description,
    parameters,
    async execute(
      toolCallId: string,
      args: Static<TSchema>,
      signal?: AbortSignal,
    ): Promise<AgentToolResult<unknown>> {
      const body = {
        tool: meta.name,
        args: args ?? {},
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
        throw new Error(`bridge request failed (${meta.name}): ${msg}`);
      }

      const text = await res.text();
      let parsed: BridgeResponse;
      try {
        parsed = JSON.parse(text) as BridgeResponse;
      } catch {
        throw new Error(
          `bridge ${meta.name} returned non-JSON (status ${res.status}): ${text.slice(0, 200)}`,
        );
      }

      if (!res.ok || !parsed.success) {
        const reason = parsed.error || `HTTP ${res.status}`;
        throw new Error(`bridge ${meta.name} failed: ${reason}`);
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
      const out = lines.join("\n").trim() || `(${meta.name} returned no message)`;

      return {
        content: [{ type: "text", text: out }],
        details: {
          tool: meta.name,
          artifacts: parsed.artifacts ?? [],
          data: parsed.data,
        },
      };
    },
  };
}
