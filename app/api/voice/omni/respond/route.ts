import { NextResponse } from "next/server";

import { ensureBootstrap } from "@/lib/inference/bootstrap";
import {
  getQwenOmniStatus,
  qwenOmniSidecarUrl,
} from "@/lib/inference/omni/local";

export const runtime = "nodejs";

const SIDECAR_TIMEOUT_MS = 60_000;

export async function POST(req: Request) {
  ensureBootstrap();
  const sidecarUrl = qwenOmniSidecarUrl();
  if (!sidecarUrl) {
    return NextResponse.json(
      {
        error:
          "OMNI_SIDECAR_URL is not configured. Run a CUDA-capable Omni sidecar that serves /e2e/respond and set OMNI_SIDECAR_URL.",
        status: getQwenOmniStatus({ probeRuntime: true }),
      },
      { status: 503 },
    );
  }

  const contentType = req.headers.get("content-type") ?? "";
  let body: BodyInit;
  let outboundContentType: string | undefined;

  if (contentType.includes("multipart/form-data")) {
    // Audio-in path. Forward the multipart payload as-is so binary stays
    // intact; let fetch set the boundary header.
    const form = await req.formData();
    const fwd = new FormData();
    for (const [key, value] of form.entries()) {
      fwd.append(key, value as Blob | string);
    }
    body = fwd;
  } else {
    // JSON / text-in path. Pass through whatever shape the client sent.
    const json = await req.json().catch(() => null);
    if (!json || typeof json !== "object") {
      return NextResponse.json(
        { error: "expected JSON body with { text? , audioUrl? , history? } or multipart form" },
        { status: 400 },
      );
    }
    body = JSON.stringify(json);
    outboundContentType = "application/json";
  }

  const target = `${sidecarUrl.replace(/\/+$/, "")}/e2e/respond`;
  let res: Response;
  try {
    res = await fetch(target, {
      method: "POST",
      body,
      headers: outboundContentType ? { "Content-Type": outboundContentType } : undefined,
      signal: AbortSignal.timeout(SIDECAR_TIMEOUT_MS),
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: `Omni sidecar unreachable at ${sidecarUrl}: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 502 },
    );
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return NextResponse.json(
      { error: `Omni sidecar ${res.status}: ${detail.slice(0, 512)}` },
      { status: 502 },
    );
  }

  const respCt = res.headers.get("content-type") ?? "application/json";
  return new Response(res.body, {
    headers: {
      "Content-Type": respCt,
      "X-Omni-Sidecar": sidecarUrl,
    },
  });
}

export async function GET() {
  const sidecarUrl = qwenOmniSidecarUrl();
  return NextResponse.json({
    configured: Boolean(sidecarUrl),
    baseURL: sidecarUrl,
    contract: {
      "POST /e2e/respond": "JSON or multipart in → { text, audio (base64) } JSON",
    },
  });
}
