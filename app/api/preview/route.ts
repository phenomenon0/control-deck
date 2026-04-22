import { NextRequest, NextResponse } from "next/server";

interface PreviewData {
  url: string;
  title: string;
  description: string;
  image: string | null;
  favicon: string | null;
  siteName: string | null;
  /**
   * Best-effort CSP hint. When a page sends X-Frame-Options: DENY / SAMEORIGIN
   * or a CSP frame-ancestors that excludes our origin, the inline iframe
   * won't render; the SourcePreview UI falls back to the OG card only.
   */
  embeddable: boolean;
}

// In-memory cache (TTL: 1 hour)
const previewCache = new Map<string, { data: PreviewData; timestamp: number }>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

function getCached(url: string): PreviewData | null {
  const cached = previewCache.get(url);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  if (cached) previewCache.delete(url);
  return null;
}

function setCache(url: string, data: PreviewData): void {
  // Limit cache size
  if (previewCache.size >= 200) {
    const oldest = previewCache.keys().next().value;
    if (oldest) previewCache.delete(oldest);
  }
  previewCache.set(url, { data, timestamp: Date.now() });
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

// Block SSRF against private / loopback / link-local / cloud-metadata ranges.
// Literal-host check only (no DNS resolution) — good enough for a deck-tool
// user-facing URL bar; upgrade to resolve+recheck if this endpoint ever
// accepts untrusted remote input.
function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "::1" || host === "[::1]") return true;

  // Strip IPv6 brackets
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;

  // IPv4 literal?
  const ipv4 = bare.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [parseInt(ipv4[1], 10), parseInt(ipv4[2], 10)];
    if (a === 127) return true;                       // loopback
    if (a === 10) return true;                        // RFC1918
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true;          // RFC1918
    if (a === 169 && b === 254) return true;          // link-local + AWS/GCP metadata
    if (a === 0) return true;                         // "this network"
    if (a >= 224) return true;                        // multicast / reserved
  }

  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10)
  if (/^f[cd][0-9a-f]{2}:/i.test(bare)) return true;
  if (/^fe[89ab][0-9a-f]:/i.test(bare)) return true;

  return false;
}

function getFaviconUrl(url: string): string {
  const domain = extractDomain(url);
  if (!domain) return "";
  // Use Google's favicon service as fallback
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
}

async function fetchPreview(url: string): Promise<PreviewData> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; PreviewBot/1.0)",
        Accept: "text/html",
      },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();

    // Detect embeddability from response headers so the UI can decide
    // between compact-card and full-iframe modes.
    const xFrameOptions = (response.headers.get("x-frame-options") ?? "").toLowerCase();
    const csp = (response.headers.get("content-security-policy") ?? "").toLowerCase();
    const blockedByXFO = xFrameOptions.includes("deny") || xFrameOptions.includes("sameorigin");
    const blockedByCsp = csp.includes("frame-ancestors 'none'") ||
      (/frame-ancestors\s+[^;]*/.test(csp) && !csp.includes("frame-ancestors *"));
    const embeddable = !blockedByXFO && !blockedByCsp;

    // Extract Open Graph and meta tags
    const ogTitle = extractMeta(html, 'property="og:title"') || 
                    extractMeta(html, "property='og:title'") ||
                    extractMeta(html, 'name="og:title"');
    const ogDescription = extractMeta(html, 'property="og:description"') || 
                          extractMeta(html, "property='og:description'") ||
                          extractMeta(html, 'name="description"');
    const ogImage = extractMeta(html, 'property="og:image"') || 
                    extractMeta(html, "property='og:image'") ||
                    extractMeta(html, 'name="twitter:image"');
    const ogSiteName = extractMeta(html, 'property="og:site_name"') ||
                       extractMeta(html, "property='og:site_name'");
    
    // Fallback to <title>
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = ogTitle || (titleMatch ? titleMatch[1].trim() : extractDomain(url));
    
    // Make image URL absolute if relative
    let image = ogImage;
    if (image && !image.startsWith("http")) {
      try {
        image = new URL(image, url).toString();
      } catch {
        image = null;
      }
    }

    return {
      url,
      title: decodeHtmlEntities(title),
      description: decodeHtmlEntities(ogDescription || ""),
      image: image || null,
      favicon: getFaviconUrl(url),
      siteName: ogSiteName || extractDomain(url),
      embeddable,
    };
  } catch (error) {
    clearTimeout(timeout);
    // Return basic fallback data
    return {
      url,
      title: extractDomain(url),
      description: "",
      image: null,
      favicon: getFaviconUrl(url),
      siteName: extractDomain(url),
      embeddable: false,
    };
  }
}

function extractMeta(html: string, attr: string): string | null {
  // Match meta tag with the specified attribute
  const regex = new RegExp(`<meta[^>]*${attr}[^>]*content=["']([^"']+)["'][^>]*>`, "i");
  const match = html.match(regex);
  if (match) return match[1];
  
  // Try reverse order (content before property)
  const regex2 = new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*${attr}[^>]*>`, "i");
  const match2 = html.match(regex2);
  return match2 ? match2[1] : null;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");

  if (!url) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  // Validate URL + block SSRF targets
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return NextResponse.json({ error: "Unsupported protocol" }, { status: 400 });
  }
  if (isBlockedHost(parsed.hostname)) {
    return NextResponse.json({ error: "Host not allowed" }, { status: 400 });
  }

  // Check cache
  const cached = getCached(url);
  if (cached) {
    return NextResponse.json(cached);
  }

  // Fetch preview
  const preview = await fetchPreview(url);
  setCache(url, preview);

  return NextResponse.json(preview);
}
