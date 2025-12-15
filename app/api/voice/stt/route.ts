import { NextResponse } from "next/server";

const VOICE_API_URL = process.env.VOICE_API_URL ?? "http://localhost:8000";

export async function POST(req: Request) {
  const formData = await req.formData();
  const audio = formData.get("audio");

  if (!audio || !(audio instanceof Blob)) {
    return NextResponse.json({ error: "audio file required" }, { status: 400 });
  }

  try {
    // Forward to voice API sidecar
    const voiceFormData = new FormData();
    voiceFormData.append("audio", audio);

    const res = await fetch(`${VOICE_API_URL}/stt`, {
      method: "POST",
      body: voiceFormData,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Voice API returned ${res.status}: ${text}`);
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
