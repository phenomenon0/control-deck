import { NextResponse } from "next/server";

const OLLAMA_URL = (process.env.OLLAMA_BASE_URL ?? process.env.OLLAMA_URL ?? "http://localhost:11434").replace("/v1", "");

export interface OllamaModel {
  name: string;
  model: string;
  modified_at: string;
  size: number;
  digest: string;
  details: {
    parent_model: string;
    format: string;
    family: string;
    families: string[];
    parameter_size: string;
    quantization_level: string;
  };
}

export interface OllamaTagsResponse {
  models: OllamaModel[];
}

export async function GET() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, {
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`Ollama returned ${res.status}`);
    }

    const data: OllamaTagsResponse = await res.json();

    // Sort by name
    data.models.sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json(data);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: msg, models: [] },
      { status: 502 }
    );
  }
}

// Pull a model — streams Ollama's NDJSON progress directly to the client.
// Heartbeat keeps the connection alive during long first-layer negotiation.
export async function POST(req: Request) {
  const { name } = await req.json();

  if (!name) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }

  let ollamaRes: Response;
  try {
    ollamaRes = await fetch(`${OLLAMA_URL}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, stream: true }),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  if (!ollamaRes.ok || !ollamaRes.body) {
    const text = await ollamaRes.text().catch(() => "");
    return NextResponse.json(
      { error: text || `Ollama returned ${ollamaRes.status}` },
      { status: 502 },
    );
  }

  const body = wrapWithHeartbeat(ollamaRes.body, 12_000);

  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

// Delete a model
export async function DELETE(req: Request) {
  const { name } = await req.json();

  if (!name) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }

  try {
    const res = await fetch(`${OLLAMA_URL}/api/delete`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });

    if (!res.ok) {
      throw new Error(`Ollama returned ${res.status}`);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

// Passes an upstream byte stream through to the client, injecting a
// `{"status":"heartbeat"}\n` line whenever no upstream bytes have flowed
// for `intervalMs`. Prevents proxies / Next.js from dropping a connection
// while Ollama is negotiating a layer but not yet emitting progress.
function wrapWithHeartbeat(upstream: ReadableStream<Uint8Array>, intervalMs: number): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const heartbeat = encoder.encode('{"status":"heartbeat"}\n');

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const reader = upstream.getReader();
      let closed = false;
      let lastFlushAt = Date.now();

      const timer = setInterval(() => {
        if (closed) return;
        if (Date.now() - lastFlushAt >= intervalMs) {
          try {
            controller.enqueue(heartbeat);
            lastFlushAt = Date.now();
          } catch {
            // controller already errored/closed
          }
        }
      }, Math.max(1_000, Math.floor(intervalMs / 2)));

      (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              controller.enqueue(value);
              lastFlushAt = Date.now();
            }
          }
          controller.close();
        } catch (err) {
          controller.error(err);
        } finally {
          closed = true;
          clearInterval(timer);
        }
      })();
    },
    cancel(reason) {
      upstream.cancel(reason).catch(() => {});
    },
  });
}
