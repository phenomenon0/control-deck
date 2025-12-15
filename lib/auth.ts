import { NextRequest, NextResponse } from "next/server";

export function checkAuth(req: NextRequest): NextResponse | null {
  const token = process.env.DECK_TOKEN;
  
  // If no token is configured, auth is disabled
  if (!token || token === "") {
    return null;
  }

  // Check Authorization header
  const authHeader = req.headers.get("Authorization");
  if (authHeader === `Bearer ${token}`) {
    return null;
  }

  // Check query param (for SSE connections)
  const url = new URL(req.url);
  const queryToken = url.searchParams.get("token");
  if (queryToken === token) {
    return null;
  }

  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function isAuthEnabled(): boolean {
  const token = process.env.DECK_TOKEN;
  return Boolean(token && token !== "");
}
