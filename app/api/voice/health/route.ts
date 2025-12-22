import { NextResponse } from "next/server";

const VOICE_API_URL = process.env.VOICE_API_URL || "http://localhost:8000";

export async function GET() {
  try {
    const res = await fetch(`${VOICE_API_URL}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok) {
      return NextResponse.json({ status: "error", message: "Voice API unhealthy" }, { status: 503 });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { status: "error", message: "Voice API unreachable" },
      { status: 503 }
    );
  }
}
