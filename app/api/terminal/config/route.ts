import { NextResponse } from "next/server";
import { discoverTerminalServiceToken } from "@/lib/terminal/service-discovery";

const LOOPBACK_HOST_RE = /^(localhost|127\.0\.0\.1)(:\d+)?$/i;

export async function GET(request: Request) {
  const hostHeader = request.headers.get("host") ?? "";
  if (!LOOPBACK_HOST_RE.test(hostHeader)) {
    return NextResponse.json({ ok: false, error: "terminal config is only exposed on loopback hosts" }, { status: 403 });
  }

  const host = process.env.TERMINAL_SERVICE_HOST ?? "127.0.0.1";
  const port = process.env.TERMINAL_SERVICE_PORT ?? "4010";
  const token = process.env.TERMINAL_SERVICE_TOKEN ?? discoverTerminalServiceToken(port) ?? "";

  if (!token) {
    return NextResponse.json({ ok: false, error: "terminal service token is not configured" });
  }

  return NextResponse.json({
    ok: true,
    baseUrl: process.env.TERMINAL_SERVICE_URL ?? `http://${host}:${port}`,
    wsBaseUrl: process.env.TERMINAL_SERVICE_WS_URL ?? `ws://${host}:${port}`,
    token,
  });
}
