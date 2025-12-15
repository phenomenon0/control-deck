import { NextResponse } from "next/server";

const COMFY_URL = process.env.COMFY_URL ?? "http://localhost:8188";

export interface ComfyHistoryItem {
  prompt: [number, string, Record<string, unknown>, Record<string, unknown>, string[]];
  outputs: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }>;
  status: {
    status_str: string;
    completed: boolean;
    messages: Array<[string, Record<string, unknown>]>;
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const promptId = url.searchParams.get("promptId");
  const limit = url.searchParams.get("limit") ?? "20";

  try {
    let endpoint = `${COMFY_URL}/history`;
    if (promptId) {
      endpoint = `${COMFY_URL}/history/${promptId}`;
    } else {
      endpoint = `${COMFY_URL}/history?max_items=${limit}`;
    }

    const res = await fetch(endpoint, { cache: "no-store" });

    if (!res.ok) {
      throw new Error(`ComfyUI returned ${res.status}`);
    }

    const data = await res.json();

    // If fetching single prompt, wrap in expected format
    if (promptId && data[promptId]) {
      return NextResponse.json({
        promptId,
        ...data[promptId],
      });
    }

    // Convert object to array with promptId included
    const items = Object.entries(data).map(([id, item]) => ({
      promptId: id,
      ...(item as ComfyHistoryItem),
    }));

    // Sort by queue position (newest first)
    items.sort((a, b) => (b.prompt?.[0] ?? 0) - (a.prompt?.[0] ?? 0));

    return NextResponse.json({ items });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: msg, items: [] }, { status: 502 });
  }
}

// Cancel/interrupt a running prompt
export async function DELETE(req: Request) {
  const { promptId } = await req.json();

  try {
    if (promptId) {
      // Delete specific prompt from history
      const res = await fetch(`${COMFY_URL}/history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delete: [promptId] }),
      });

      if (!res.ok) {
        throw new Error(`ComfyUI returned ${res.status}`);
      }
    } else {
      // Interrupt current execution
      const res = await fetch(`${COMFY_URL}/interrupt`, {
        method: "POST",
      });

      if (!res.ok) {
        throw new Error(`ComfyUI returned ${res.status}`);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
