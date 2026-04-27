/**
 * GET /api/debug/hub — snapshot of the in-process AG-UI event hub.
 *
 * Use this when SSE consumers feel stuck or the chat stream goes silent:
 * the response shows every channel and how many subscribers are attached.
 * A leaked listener (eg. an SSE response that never aborted) shows up
 * immediately as an out-of-band channel still holding listeners.
 *
 * The same-origin guard keeps this off the public network — the hub
 * doesn't leak event payloads, but channel ids are thread/run identifiers
 * we'd rather not gossip.
 */

import { NextResponse } from "next/server";
import { hub } from "@/lib/agui/hub";
import { denyIfCrossOrigin } from "@/lib/security/originGuard";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const denied = denyIfCrossOrigin(req);
  if (denied) return denied;
  return NextResponse.json(hub.stats());
}
