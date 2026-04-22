/**
 * GET /api/tools — catalogue of Zod-defined tool schemas + usage stats.
 *
 * Wire for the Capabilities > Tools tab. Reads TOOL_DEFINITIONS (canonical
 * list for the LLM), joins with the invocation stats we've been recording,
 * and returns a sorted array. No write endpoints — tool schemas are
 * code-authored; humans edit `lib/tools/definitions.ts`.
 */

import { NextResponse } from "next/server";
import { TOOL_DEFINITIONS } from "@/lib/tools/definitions";
import { getInvocationStats } from "@/lib/agui/db";

export async function GET() {
  const statsMap = new Map(getInvocationStats("tool").map((s) => [s.targetId, s]));
  const tools = TOOL_DEFINITIONS.map((def) => {
    const stat = statsMap.get(def.name);
    return {
      name: def.name,
      description: def.description,
      parameters: def.parameters,
      stats: stat
        ? {
            count: stat.count,
            errors: stat.errors,
            lastInvokedAt: stat.lastInvokedAt,
            avgDurationMs: stat.avgDurationMs,
          }
        : { count: 0, errors: 0, lastInvokedAt: null, avgDurationMs: null },
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({ tools });
}
