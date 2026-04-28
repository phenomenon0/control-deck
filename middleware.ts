import { NextRequest, NextResponse } from "next/server";

const IS_PROD = process.env.NODE_ENV === "production";

if (!process.env.DECK_TOKEN) {
  if (IS_PROD) {
    // In packaged builds Electron auto-generates a token on launch — if we
    // land here, the env was stripped somewhere. Fail closed rather than
    // silently serve every request.
    console.error("[deck] DECK_TOKEN missing in production — /api/* will 503 until it's set");
  } else {
    console.warn("[deck] DECK_TOKEN unset — /api/* is unauthenticated (fine for localhost-only dev, unsafe otherwise)");
  }
}

/**
 * Next.js middleware — gates all /api/* routes with DECK_TOKEN auth.
 *
 * Dev (no token):   requests pass through (localhost convenience).
 * Prod (no token):  503 — something is misconfigured, better to surface it
 *                   loudly than to quietly expose every route.
 * Token set:        Authorization: Bearer <token> OR X-Deck-Token required.
 */
export function middleware(req: NextRequest) {
  const token = process.env.DECK_TOKEN;

  if (!token || token === "") {
    if (IS_PROD) {
      return NextResponse.json(
        { error: "Backend misconfigured: DECK_TOKEN missing" },
        { status: 503 },
      );
    }
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

  // Agent-GO receives only a callback URL for the tools bridge in this app.
  // Permit a bridge-scoped URL token only on that endpoint; all other API
  // routes still require a header/Bearer credential.
  if (req.nextUrl.pathname === "/api/tools/bridge") {
    const bridgeToken = process.env.TOOL_BRIDGE_TOKEN || token;
    if (req.nextUrl.searchParams.get("bridge_token") === bridgeToken) {
      return NextResponse.next();
    }
  }

  // Same shortcut for the MCP tools surface (agent-ts only sees a URL).
  if (req.nextUrl.pathname === "/api/mcp/tools") {
    if (req.nextUrl.searchParams.get("token") === token) {
      return NextResponse.next();
    }
  }

  // And for the bridge tool catalog, which agent-ts derives from the bridge URL.
  if (req.nextUrl.pathname === "/api/tools/catalog") {
    if (req.nextUrl.searchParams.get("token") === token) {
      return NextResponse.next();
    }
    // Also accept a bridge_token (lets `deriveCatalogUrl` reuse the bridge URL
    // without re-injecting a separate token query).
    const bridgeToken = process.env.TOOL_BRIDGE_TOKEN || token;
    if (req.nextUrl.searchParams.get("bridge_token") === bridgeToken) {
      return NextResponse.next();
    }
  }

  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export const config = {
  matcher: "/api/:path*",
};
