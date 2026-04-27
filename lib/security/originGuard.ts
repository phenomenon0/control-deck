/**
 * Same-origin guard for side-effect API routes.
 *
 * Localhost is *not* a security boundary — a malicious local website (or
 * browser extension) can attempt POSTs to our routes if it discovers
 * the bridge token (e.g. from logs, an open dev tool, or another tab).
 * Even when the response body is hidden by CORS, the side effect still
 * happens.
 *
 * This module hardens that surface with a simple rule: if the request
 * comes from a browser (Origin header set), the Origin must match the
 * request host. If Origin is absent the request is server-to-server
 * (Node fetch, agent-ts, scripts) and we let it through — the route's
 * own token check is the auth surface there.
 *
 * Loopback variants (http://127.0.0.1[:port], http://[::1][:port],
 * http://localhost[:port]) are all treated as equivalent for the
 * purpose of "same host" so the dev server (`next dev -p 3333`) works
 * regardless of which alias the browser dialed.
 */

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

function normaliseHost(value: string): string {
  // strip brackets from IPv6, lowercase
  return value.replace(/^\[|\]$/g, "").toLowerCase();
}

function hostFromUrl(value: string): { host: string; port: string } | null {
  try {
    const u = new URL(value);
    return { host: normaliseHost(u.hostname), port: u.port };
  } catch {
    return null;
  }
}

/**
 * Returns true when the request's Origin matches its target host
 * (loopback aliases collapsed). Returns true when no Origin header is
 * set — that's the server-to-server case (agent-ts, Node scripts).
 */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // server-to-server — token check elsewhere

  const target = hostFromUrl(req.url);
  const sender = hostFromUrl(origin);
  if (!target || !sender) return false;

  // Both loopback hosts → treat as same regardless of alias variant.
  if (LOOPBACK_HOSTS.has(target.host) && LOOPBACK_HOSTS.has(sender.host)) {
    return target.port === sender.port;
  }

  return target.host === sender.host && target.port === sender.port;
}

/**
 * Returns a 403 Response when the request fails the same-origin check,
 * or `null` when the request passes (caller should continue handling).
 */
export function denyIfCrossOrigin(req: Request): Response | null {
  if (isSameOrigin(req)) return null;
  return Response.json(
    { error: "cross-origin request denied" },
    { status: 403 },
  );
}
