import { NextResponse } from "next/server";

const COMFY_URL = process.env.COMFY_URL ?? "http://localhost:8188";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const filename = url.searchParams.get("filename");
  const subfolder = url.searchParams.get("subfolder") ?? "";
  const type = url.searchParams.get("type") ?? "output";

  if (!filename) {
    return NextResponse.json({ error: "filename required" }, { status: 400 });
  }

  try {
    const params = new URLSearchParams({ filename, subfolder, type });
    const res = await fetch(`${COMFY_URL}/view?${params}`, {
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`ComfyUI returned ${res.status}`);
    }

    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    const buffer = await res.arrayBuffer();

    return new Response(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
