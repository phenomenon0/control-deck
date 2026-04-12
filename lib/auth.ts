import { NextRequest, NextResponse } from "next/server";

export function checkAuth(req: NextRequest): NextResponse | null {
  const token = process.env.DECK_TOKEN;

  // If no token is configured, auth is disabled
  if (!token || token === "") {
    return null;
  }

  // Check Authorization header (Bearer token)
  const authHeader = req.headers.get("Authorization");
  if (authHeader === `Bearer ${token}`) {
    return null;
  }

  // Check X-Deck-Token header (for SSE/EventSource which can't set Authorization)
  const deckTokenHeader = req.headers.get("X-Deck-Token");
  if (deckTokenHeader === token) {
    return null;
  }

  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function isAuthEnabled(): boolean {
  const token = process.env.DECK_TOKEN;
  return Boolean(token && token !== "");
}
