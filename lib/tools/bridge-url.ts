function firstHeaderValue(value: string | null): string | null {
  return value?.split(",")[0]?.trim() || null;
}

function requestOrigin(req: Request): string {
  const fallback = new URL(req.url);
  if (process.env.CONTROL_DECK_TRUST_PROXY_HEADERS !== "1") {
    return fallback.origin;
  }

  const forwardedHost = firstHeaderValue(req.headers.get("x-forwarded-host"));
  if (!forwardedHost) return fallback.origin;

  const forwardedProto = firstHeaderValue(req.headers.get("x-forwarded-proto"));
  return `${forwardedProto ?? fallback.protocol.replace(":", "")}://${forwardedHost}`;
}

/**
 * Agent-GO only receives a callback URL from this route. In packaged Electron
 * the server port is chosen dynamically, so derive the default bridge URL from
 * the actual request origin instead of assuming the dev port.
 */
export function buildToolBridgeUrl(req: Request): string {
  const origin = requestOrigin(req);
  const configured = process.env.TOOL_BRIDGE_URL;
  const url = configured
    ? new URL(configured, origin)
    : new URL("/api/tools/bridge", origin);

  const isLocalBridge = url.origin === origin && url.pathname === "/api/tools/bridge";
  if (isLocalBridge && !url.searchParams.has("bridge_token")) {
    const bridgeToken = process.env.TOOL_BRIDGE_TOKEN ?? process.env.DECK_TOKEN;
    if (bridgeToken) {
      url.searchParams.set("bridge_token", bridgeToken);
    }
  }

  return url.toString();
}

/**
 * Build the absolute URL agent-ts should use for MCP discovery + dispatch.
 * Mirrors the bridge URL pattern: derive from the inbound request origin so
 * Electron's dynamic port still works, and append DECK_TOKEN as a bearer
 * header would be ignored across loopback (we pass it as ?token instead).
 */
export function buildMcpToolsUrl(req: Request): string {
  const origin = requestOrigin(req);
  const url = new URL("/api/mcp/tools", origin);
  const token = process.env.DECK_TOKEN;
  if (token && !url.searchParams.has("token")) {
    url.searchParams.set("token", token);
  }
  return url.toString();
}
