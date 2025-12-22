import { NextResponse } from "next/server";
import type { NewsData, NewsItem } from "@/lib/widgets/types";

// Cache news for 5 minutes
let cache: { data: NewsData; timestamp: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000;

// RSS feed URLs
const FEEDS = [
  { url: "https://hnrss.org/frontpage?count=5", source: "HN", category: "tech" as const },
  { url: "https://feeds.arstechnica.com/arstechnica/technology-lab", source: "Ars", category: "tech" as const },
];

async function parseRSS(url: string, source: string, category: NewsItem["category"]): Promise<NewsItem[]> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Control-Deck/1.0" },
      next: { revalidate: 300 },
    });
    
    if (!res.ok) return [];
    
    const xml = await res.text();
    const items: NewsItem[] = [];
    
    // Simple XML parsing for RSS items
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    const titleRegex = /<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/;
    const linkRegex = /<link>(.*?)<\/link>/;
    const pubDateRegex = /<pubDate>(.*?)<\/pubDate>/;
    
    let match;
    while ((match = itemRegex.exec(xml)) !== null && items.length < 5) {
      const itemXml = match[1];
      
      const titleMatch = titleRegex.exec(itemXml);
      const linkMatch = linkRegex.exec(itemXml);
      const dateMatch = pubDateRegex.exec(itemXml);
      
      const title = titleMatch?.[1] || titleMatch?.[2] || "";
      const link = linkMatch?.[1] || "";
      const pubDate = dateMatch?.[1] || "";
      
      if (title && link) {
        items.push({
          id: Buffer.from(link).toString("base64").slice(0, 16),
          title: title.trim().slice(0, 100),
          source,
          url: link.trim(),
          time: pubDate ? formatTimeAgo(new Date(pubDate)) : "",
          category,
        });
      }
    }
    
    return items;
  } catch (error) {
    console.error(`[News Widget] Failed to parse ${source}:`, error);
    return [];
  }
}

function formatTimeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 1) return "< 1h";
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export async function GET() {
  // Check cache
  if (cache && Date.now() - cache.timestamp < CACHE_TTL) {
    return NextResponse.json(cache.data);
  }

  try {
    // Fetch all feeds in parallel
    const results = await Promise.all(
      FEEDS.map((feed) => parseRSS(feed.url, feed.source, feed.category))
    );
    
    // Flatten and interleave results
    const allItems: NewsItem[] = [];
    const maxLen = Math.max(...results.map((r) => r.length));
    
    for (let i = 0; i < maxLen; i++) {
      for (const feedItems of results) {
        if (feedItems[i]) {
          allItems.push(feedItems[i]);
        }
      }
    }
    
    const news: NewsData = {
      items: allItems.slice(0, 8),
      updatedAt: new Date().toISOString(),
    };

    cache = { data: news, timestamp: Date.now() };
    return NextResponse.json(news);
  } catch (error) {
    console.error("[News Widget] Error:", error);
    
    if (cache) {
      return NextResponse.json(cache.data);
    }
    
    return NextResponse.json(
      { error: "Failed to fetch news" },
      { status: 500 }
    );
  }
}
