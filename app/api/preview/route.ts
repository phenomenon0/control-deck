import { NextRequest, NextResponse } from "next/server";

interface PreviewData {
  title: string;
  description: string;
  image: string | null;
  favicon: string | null;
  siteName: string | null;
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
      title: decodeHtmlEntities(title),
      description: decodeHtmlEntities(ogDescription || ""),
      image: image || null,
      favicon: getFaviconUrl(url),
      siteName: ogSiteName || extractDomain(url),
    };
  } catch (error) {
    clearTimeout(timeout);
    // Return basic fallback data
    return {
      title: extractDomain(url),
      description: "",
      image: null,
      favicon: getFaviconUrl(url),
      siteName: extractDomain(url),
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

  // Validate URL
  try {
    new URL(url);
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
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
