import { NextRequest, NextResponse } from "next/server";

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
  _engines?: string;
}

// Simple in-memory cache (TTL: 5 minutes)
const searchCache = new Map<string, { results: SearchResult[]; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCachedResults(cacheKey: string): SearchResult[] | null {
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`[Search] Cache hit for: ${cacheKey}`);
    return cached.results;
  }
  if (cached) {
    searchCache.delete(cacheKey);
  }
  return null;
}

function setCachedResults(cacheKey: string, results: SearchResult[]): void {
  // Limit cache size to 100 entries
  if (searchCache.size >= 100) {
    const oldestKey = searchCache.keys().next().value;
    if (oldestKey) searchCache.delete(oldestKey);
  }
  searchCache.set(cacheKey, { results, timestamp: Date.now() });
}

// Rotating user agents for anti-detection
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
];

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

const YEAR_PATTERN = /\b20\d{2}\b/;
const MONTH_PATTERN = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/;
const DAY_PATTERN = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/;
const DATE_CONTEXT_PATTERN = new RegExp(`${YEAR_PATTERN.source}|${MONTH_PATTERN.source}`, "i");

export interface SearchPlan {
  isNews: boolean;
  optimizedQuery: string;
}

function formatSearchDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function getThisWeekRange(now = new Date()): { start: Date; end: Date } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay());

  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start, end };
}

// Detect if query is news/current events related
function isNewsQuery(query: string): boolean {
  const q = query.toLowerCase();
  const newsPatterns = [
    // Sports results/fixtures
    /\b(results?|scores?|fixtures?|match|game|vs|versus|standings|table|league)\b/,
    // Time-sensitive
    /\b(today|yesterday|this week|last week|recent|latest|current|now|live)\b/,
    // News indicators
    /\b(news|update|announcement|released|launches?|happening|breaking)\b/,
    // Date patterns
    YEAR_PATTERN,
    MONTH_PATTERN,
    DAY_PATTERN,
    // Stock/market
    /\b(stock|price|market|trading|crypto|bitcoin|eth)\b/,
    // Weather
    /\b(weather|forecast|temperature)\b/,
    // Events
    /\b(election|vote|poll|protest|incident|crash|attack)\b/,
    // Live events
    /\b(live music|concerts?|shows?|gigs?|venues?|tickets?|festival|tour)\b/,
  ];
  
  return newsPatterns.some(pattern => pattern.test(q));
}

// Optimize query for better search results
function optimizeQuery(query: string, isNews: boolean): string {
  const q = query.toLowerCase();
  let optimized = query;
  
  // For sports queries, add context if not present
  if (/\b(arsenal|chelsea|liverpool|manchester|barcelona|real madrid|bayern)\b/i.test(q)) {
    if (!/\b(football|soccer|premier league|la liga|champions)\b/i.test(q)) {
      // It's likely a football query
      if (/\b(results?|scores?|fixtures?)\b/i.test(q)) {
        // Add "football" for clarity
        if (!q.includes("football")) {
          optimized = `${query} football`;
        }
      }
    }
  }
  
  // For "this week" queries, add current date context
  if (/\bthis week\b/i.test(q) && isNews) {
    const { start, end } = getThisWeekRange();
    const weekRange = `${formatSearchDate(start)} to ${formatSearchDate(end)}`;
    
    // Only add if no date context exists
    if (!DATE_CONTEXT_PATTERN.test(q)) {
      optimized = `${query} ${weekRange}`;
    }
  }
  
  return optimized;
}

export function createSearchPlan(query: string): SearchPlan {
  const isNews = isNewsQuery(query);
  return {
    isNews,
    optimizedQuery: optimizeQuery(query, isNews),
  };
}

// Retry with exponential backoff
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3,
  baseDelay = 500
): Promise<Response> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;
      
      // If rate limited, wait longer
      if (response.status === 429) {
        const delay = baseDelay * Math.pow(2, attempt + 1);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      // Other errors, just return
      return response;
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError || new Error("Max retries reached");
}

// Primary: SearXNG (Podman: localhost:8888)
async function searchSearXNG(
  query: string, 
  maxResults: number,
  categories: string = "general"
): Promise<SearchResult[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    
    // Build search URL with category
    const searchParams = new URLSearchParams({
      q: query,
      format: "json",
      safesearch: "0",
    });
    
    // Add categories parameter
    if (categories !== "general") {
      searchParams.set("categories", categories);
    }
    
    const res = await fetchWithRetry(
      `http://localhost:8888/search?${searchParams.toString()}`,
      {
        signal: controller.signal,
        headers: {
          "User-Agent": getRandomUserAgent(),
          "Accept": "application/json",
        },
      },
      2,
      300
    );
    
    clearTimeout(timeout);
    
    if (!res.ok) {
      console.error(`SearXNG returned ${res.status}`);
      return [];
    }
    
    const data = await res.json();
    
    if (!data.results || data.results.length === 0) {
      console.log("SearXNG returned no results");
      return [];
    }
    
    return data.results.slice(0, maxResults).map((r: { 
      title?: string; 
      url?: string; 
      content?: string;
      engines?: string[];
      publishedDate?: string;
    }) => ({
      title: r.title || "Untitled",
      url: r.url || "",
      snippet: r.content || "",
      publishedDate: r.publishedDate || undefined,
      _engines: r.engines?.join(", ") || "unknown",
    }));
  } catch (error) {
    console.error("SearXNG error:", error);
    return [];
  }
}

// News-specific search using SearXNG news category
async function searchNews(query: string, maxResults: number): Promise<SearchResult[]> {
  console.log(`[Search] Using news category for: "${query}"`);
  return searchSearXNG(query, maxResults, "news");
}

// Fallback 1: duck-duck-scrape library
async function searchDDG(query: string, maxResults: number): Promise<SearchResult[]> {
  try {
    // Dynamic import to handle potential module issues
    const { search, SafeSearchType } = await import("duck-duck-scrape");
    
    const response = await search(query, {
      safeSearch: SafeSearchType.OFF,
    });
    
    if (response.noResults || !response.results) {
      return [];
    }
    
    return response.results.slice(0, maxResults).map((r) => ({
      title: r.title || "Untitled",
      url: r.url || "",
      snippet: r.description || "",
    }));
  } catch (error) {
    console.error("DDG search error:", error);
    return [];
  }
}

// Fallback 2: Public SearXNG instances (last resort)
const PUBLIC_SEARXNG_INSTANCES = [
  "https://search.sapti.me",
  "https://searx.be",
  "https://search.hbubli.cc",
];

async function searchPublicSearXNG(query: string, maxResults: number): Promise<SearchResult[]> {
  for (const instance of PUBLIC_SEARXNG_INSTANCES) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      
      const res = await fetch(
        `${instance}/search?q=${encodeURIComponent(query)}&format=json`,
        {
          signal: controller.signal,
          headers: {
            "User-Agent": getRandomUserAgent(),
            "Accept": "application/json",
          },
        }
      );
      
      clearTimeout(timeout);
      
      if (!res.ok) continue;
      
      const data = await res.json();
      if (!data.results || data.results.length === 0) continue;
      
      return data.results.slice(0, maxResults).map((r: { 
        title?: string; 
        url?: string; 
        content?: string;
      }) => ({
        title: r.title || "Untitled",
        url: r.url || "",
        snippet: r.content || "",
      }));
    } catch {
      continue;
    }
  }
  
  return [];
}

// Main search function with cascading fallbacks
async function webSearch(query: string, maxResults = 5, plan = createSearchPlan(query)): Promise<SearchResult[]> {
  const { isNews, optimizedQuery } = plan;
  
  console.log(`[Search] Query: "${query}"`);
  console.log(`[Search] Optimized: "${optimizedQuery}" (isNews: ${isNews})`);
  
  // Check cache first
  const cacheKey = `${optimizedQuery}:${isNews}:${maxResults}`;
  const cachedResults = getCachedResults(cacheKey);
  if (cachedResults) {
    return cachedResults;
  }
  
  let results: SearchResult[] = [];
  
  // For news queries, try news category first, then blend with general
  if (isNews) {
    // Search both news and general in parallel for better coverage
    const [newsResults, generalResults] = await Promise.all([
      searchNews(optimizedQuery, maxResults),
      searchSearXNG(optimizedQuery, maxResults, "general"),
    ]);
    
    // Merge results, prioritizing news but including general for context
    const seenUrls = new Set<string>();
    results = [];
    
    // Add news results first
    for (const r of newsResults) {
      if (!seenUrls.has(r.url)) {
        seenUrls.add(r.url);
        results.push(r);
      }
    }
    
    // Fill with general results
    for (const r of generalResults) {
      if (!seenUrls.has(r.url) && results.length < maxResults) {
        seenUrls.add(r.url);
        results.push(r);
      }
    }
    
    if (results.length > 0) {
      console.log(`[Search] News+General returned ${results.length} results`);
      setCachedResults(cacheKey, results);
      return results;
    }
  }
  
  // Try SearXNG first (local Podman instance)
  results = await searchSearXNG(optimizedQuery, maxResults, "general");
  if (results.length > 0) {
    console.log(`[Search] SearXNG returned ${results.length} results`);
    setCachedResults(cacheKey, results);
    return results;
  }
  
  // Fallback to duck-duck-scrape
  console.log("[Search] SearXNG failed, trying duck-duck-scrape...");
  results = await searchDDG(optimizedQuery, maxResults);
  if (results.length > 0) {
    console.log(`[Search] DDG returned ${results.length} results`);
    setCachedResults(cacheKey, results);
    return results;
  }
  
  // Last resort: public SearXNG instances
  console.log("[Search] DDG failed, trying public SearXNG instances...");
  results = await searchPublicSearXNG(optimizedQuery, maxResults);
  if (results.length > 0) {
    console.log(`[Search] Public SearXNG returned ${results.length} results`);
    setCachedResults(cacheKey, results);
    return results;
  }
  
  console.log("[Search] All search methods failed");
  return [];
}

// Format results for LLM context injection
function formatResultsForContext(results: SearchResult[], query: string, optimizedQuery?: string): string {
  if (results.length === 0) {
    return "";
  }
  
  const searchedAs = optimizedQuery && optimizedQuery !== query ? `; searched as "${optimizedQuery}"` : "";
  let context = `[Web search results for "${query}"${searchedAs}]\n\n`;
  
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    context += `${i + 1}. ${r.title}\n`;
    context += `   ${r.url}\n`;
    if (r.publishedDate) {
      context += `   Published: ${r.publishedDate}\n`;
    }
    if (r.snippet) {
      context += `   ${r.snippet}\n`;
    }
    context += "\n";
  }
  
  return context;
}

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q");
  const maxResults = parseInt(req.nextUrl.searchParams.get("max") || "5");
  
  if (!query) {
    return NextResponse.json({ error: "Missing query parameter 'q'" }, { status: 400 });
  }
  
  const plan = createSearchPlan(query);
  const results = await webSearch(query, maxResults, plan);
  const context = formatResultsForContext(results, query, plan.optimizedQuery);
  
  return NextResponse.json({
    query,
    optimizedQuery: plan.optimizedQuery,
    isNewsQuery: plan.isNews,
    results,
    context,
    count: results.length,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { query, maxResults = 5 } = body;
    
    if (!query) {
      return NextResponse.json({ error: "Missing query" }, { status: 400 });
    }
    
    const plan = createSearchPlan(query);
    const results = await webSearch(query, maxResults, plan);
    const context = formatResultsForContext(results, query, plan.optimizedQuery);
    
    return NextResponse.json({
      query,
      optimizedQuery: plan.optimizedQuery,
      isNewsQuery: plan.isNews,
      results,
      context,
      count: results.length,
    });
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}
