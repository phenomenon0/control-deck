import { NextRequest } from "next/server";

import { s2sLabUrl } from "@/lib/voice/s2s-url";

export const runtime = "nodejs";

const ACTION_HEADER = "X-Voice-Lab-Action";

type RouteContext = {
  params: Promise<{ path?: string[] }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  return proxyVoiceLab(context, "GET");
}

export async function POST(request: NextRequest, context: RouteContext) {
  const body = await request.text();
  return proxyVoiceLab(context, "POST", body);
}

export function PUT() {
  return methodNotAllowed();
}

export function PATCH() {
  return methodNotAllowed();
}

export function DELETE() {
  return methodNotAllowed();
}

async function proxyVoiceLab(
  context: RouteContext,
  method: "GET" | "POST",
  body?: string,
): Promise<Response> {
  const { path = [] } = await context.params;
  if (path.length === 0) {
    return Response.json({ error: "Missing Voice Lab path." }, { status: 400 });
  }

  const base = s2sLabUrl().replace(/\/+$/, "");
  const target = `${base}/v1/voice-lab/${path.map(encodeURIComponent).join("/")}`;
  const headers = new Headers({ Accept: "application/json" });
  const init: RequestInit = {
    method,
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  };

  if (method === "POST") {
    headers.set(ACTION_HEADER, "1");
    if (body && body.trim()) {
      headers.set("Content-Type", "application/json");
      init.body = body;
    }
  }

  try {
    const upstream = await fetch(target, init);
    const contentType = upstream.headers.get("content-type") ?? "application/json";
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: { "Content-Type": contentType },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Voice Lab supervisor is unreachable." },
      { status: 502 },
    );
  }
}

function methodNotAllowed() {
  return Response.json(
    { error: "Voice Lab proxy only accepts GET and POST." },
    { status: 405, headers: { Allow: "GET, POST" } },
  );
}
