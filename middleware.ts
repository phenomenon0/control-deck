import { NextRequest, NextResponse } from "next/server";

/**
 * Next.js middleware — gates all /api/* routes with DECK_TOKEN auth.
 * When DECK_TOKEN is unset, all requests pass through (auth disabled).
 */
export function middleware(req: NextRequest) {
  const token = process.env.DECK_TOKEN;

  // Auth disabled when no token configured
  if (!token || token === "") {
    return NextResponse.next();
  }

  // Bearer token in Authorization header
  const authHeader = req.headers.get("Authorization");
  if (authHeader === `Bearer ${token}`) {
    return NextResponse.next();
  }

  // X-Deck-Token header (for SSE/EventSource which can't set Authorization)
  const deckTokenHeader = req.headers.get("X-Deck-Token");
  if (deckTokenHeader === token) {
    return NextResponse.next();
  }

  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export const config = {
  matcher: "/api/:path*",
};
