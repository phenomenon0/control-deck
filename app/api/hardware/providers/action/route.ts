/**
 * POST /api/hardware/providers/action — unified load/unload dispatcher.
 *
 * Body: { providerId: ProviderId, action: "load" | "unload", model: string }
 *
 * Route instead of per-provider sub-routes because:
 *   - Adapter IDs are stable; one entry-point is cheaper to maintain.
 *   - The adapter's `capabilities` flags are the source of truth for
 *     whether an action is allowed — we refuse at this layer with 409.
 */

import { NextResponse } from "next/server";
import { getAdapter } from "@/lib/hardware/providers/registry";
import type { ProviderId } from "@/lib/hardware/providers/types";

type Action = "load" | "unload";

export async function POST(req: Request) {
  let body: { providerId?: string; action?: string; model?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const { providerId, action, model } = body;
  if (!providerId || !model || (action !== "load" && action !== "unload")) {
    return NextResponse.json(
      { error: "body must be { providerId, action: load|unload, model }" },
      { status: 400 },
    );
  }
  const adapter = getAdapter(providerId as ProviderId);
  if (!adapter) {
    return NextResponse.json({ error: `unknown provider: ${providerId}` }, { status: 404 });
  }

  const actAs = action as Action;
  const supported = adapter.capabilities[actAs];
  if (!supported) {
    const reason =
      actAs === "load" ? adapter.capabilities.loadReason : adapter.capabilities.unloadReason;
    return NextResponse.json(
      { error: reason ?? `${adapter.label} does not support ${actAs}` },
      { status: 409 },
    );
  }

  const handler = adapter[actAs];
  if (!handler) {
    return NextResponse.json(
      { error: `${adapter.label} advertises ${actAs} but has no handler` },
      { status: 500 },
    );
  }

  try {
    await handler(model);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : `${actAs} failed`;
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
