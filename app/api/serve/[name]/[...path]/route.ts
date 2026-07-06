/**
 * /api/serve/[name]/[...path] — named-endpoint proxy.
 *
 * Looks up the served `name` → { providerId, model }, then forwards the request
 * to `resolveProviderUrl(providerId) + "/" + path` — where `path` is everything
 * after the name and already carries the `v1/…` prefix the caller wrote (e.g.
 * /api/serve/my-llm/v1/chat/completions → http://localhost:11434/v1/chat/completions).
 *
 * The served `model` is injected into the JSON body (override/insert), so
 * callers never pass one. Streaming (SSE) and non-streaming responses are both
 * piped straight back. Unknown name → 404.
 *
 * Auth: middleware.ts gates this path; it accepts ?token=<DECK_TOKEN> so a
 * caller holding only the URL can reach it. The token query is stripped before
 * forwarding upstream.
 */

import { NextResponse } from "next/server";
import { resolveProviderUrl } from "@/lib/hardware/settings";
import type { SettingsProviderId } from "@/lib/settings/schema";
import { getServed } from "@/lib/serve/store";

type Ctx = { params: Promise<{ name: string; path: string[] }> };

function targetUrl(providerId: string, path: string[], search: URLSearchParams): string | null {
  const base = resolveProviderUrl(providerId as SettingsProviderId);
  if (!base) return null;
  const suffix = (path ?? []).map((p) => encodeURIComponent(p)).join("/");
  const q = new URLSearchParams(search);
  q.delete("token"); // deck auth token — not for the runtime
  const qs = q.toString();
  return `${base}/${suffix}${qs ? `?${qs}` : ""}`;
}

export async function GET(req: Request, ctx: Ctx) {
  return proxy(req, ctx, "GET");
}

export async function POST(req: Request, ctx: Ctx) {
  return proxy(req, ctx, "POST");
}

async function proxy(req: Request, ctx: Ctx, method: "GET" | "POST"): Promise<Response> {
  const { name, path } = await ctx.params;
  const served = getServed(name);
  if (!served) {
    return NextResponse.json({ error: `no served endpoint named "${name}"` }, { status: 404 });
  }

  const url = targetUrl(served.providerId, path, new URL(req.url).searchParams);
  if (!url) {
    return NextResponse.json({ error: `provider "${served.providerId}" has no resolvable URL` }, { status: 500 });
  }

  const headers: Record<string, string> = { Accept: req.headers.get("accept") ?? "application/json" };
  let outBody: string | undefined;

  if (method === "POST") {
    const raw = await req.text();
    // Inject the pinned model into the JSON body; forward as-is if not JSON.
    try {
      const json = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      json.model = served.model;
      outBody = JSON.stringify(json);
    } catch {
      outBody = raw;
    }
    headers["Content-Type"] = "application/json";
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, { method, headers, body: outBody, cache: "no-store" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unreachable";
    return NextResponse.json({ error: `runtime unreachable: ${msg}` }, { status: 502 });
  }

  // Pipe the upstream response straight through — works for both a single JSON
  // body and an SSE token stream.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/json",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
