import { NextResponse } from "next/server";

const VOICE_API_URL = process.env.VOICE_API_URL ?? "http://localhost:8000";

export async function POST(req: Request) {
  const { text, engine, voice } = await req.json();

  if (!text) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }

  try {
    const res = await fetch(`${VOICE_API_URL}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        voice: voice ?? "jenny", // Default to Jenny voice (Piper)
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Voice API returned ${res.status}: ${errText}`);
    }

    const contentType = res.headers.get("content-type") ?? "audio/wav";
    const buffer = await res.arrayBuffer();

    return new Response(buffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": 'inline; filename="speech.wav"',
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

// Get available voices
export async function GET() {
  try {
    const res = await fetch(`${VOICE_API_URL}/voices`, {
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`Voice API returned ${res.status}`);
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: msg, voices: [] }, { status: 502 });
  }
}
