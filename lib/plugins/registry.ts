/**
 * Plugin Tool Registry
 * 
 * Allowlisted tools that plugins can use. Each tool has:
 * - Strict input/output types
 * - Rate limiting
 * - Optional authentication requirements
 */

import type { ToolDefinition, ToolHandler, ToolResult, ConfigField } from "./types";

const DECK_BASE_URL = process.env.DECK_BASE_URL ?? "http://localhost:3333";

// =============================================================================
// Tool Registry
// =============================================================================

export interface RegisteredTool {
  definition: ToolDefinition;
  handler: ToolHandler;
}

export const TOOL_REGISTRY: Record<string, RegisteredTool> = {};

/**
 * Register a tool in the registry
 */
export function registerTool(
  id: string,
  definition: Omit<ToolDefinition, "id">,
  handler: ToolHandler
): void {
  TOOL_REGISTRY[id] = {
    definition: { id, ...definition },
    handler,
  };
}

/**
 * Get a tool by ID
 */
export function getTool(id: string): RegisteredTool | undefined {
  return TOOL_REGISTRY[id];
}

/**
 * List all available tools
 */
export function listTools(): ToolDefinition[] {
  return Object.values(TOOL_REGISTRY).map(t => t.definition);
}

/**
 * Execute a tool with rate limiting and error handling
 */
export async function executeTool(
  toolId: string,
  input: Record<string, unknown>
): Promise<ToolResult> {
  const tool = TOOL_REGISTRY[toolId];
  
  if (!tool) {
    return {
      success: false,
      error: `Unknown tool: ${toolId}`,
    };
  }

  try {
    // TODO: Add rate limiting
    const result = await tool.handler(input);
    return {
      ...result,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Tool execution failed",
    };
  }
}

// =============================================================================
// Built-in Tools
// =============================================================================

// --- web.search ---
registerTool(
  "web.search",
  {
    name: "Web Search",
    description: "Search the web for current information",
    inputSchema: {
      query: {
        type: "string",
        label: "Search Query",
        required: true,
      } as ConfigField,
      max: {
        type: "number",
        label: "Max Results",
        default: 5,
        min: 1,
        max: 20,
      } as ConfigField,
      recency: {
        type: "string",
        label: "Recency",
        default: "any",
        options: ["any", "1h", "24h", "7d", "30d"],
      } as ConfigField,
    },
    outputDescription: "Array of search results with title, url, snippet",
    rateLimit: 10,
  },
  async (input) => {
    const { query, max = 5, recency = "any" } = input as { 
      query: string; 
      max?: number;
      recency?: string;
    };

    try {
      // Use the existing search API
      const params = new URLSearchParams({
        q: query,
        max: String(max),
      });
      
      if (recency && recency !== "any") {
        params.set("recency", recency);
      }

      const response = await fetch(`${DECK_BASE_URL}/api/search?${params}`);
      
      if (!response.ok) {
        throw new Error(`Search failed: ${response.status}`);
      }

      const data = await response.json();
      
      return {
        success: true,
        data: {
          results: data.results || [],
          count: data.count || 0,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Search failed",
      };
    }
  }
);

// --- rss.fetch ---
registerTool(
  "rss.fetch",
  {
    name: "RSS Feed",
    description: "Fetch and parse an RSS/Atom feed",
    inputSchema: {
      url: {
        type: "string",
        label: "Feed URL",
        required: true,
      } as ConfigField,
      max: {
        type: "number",
        label: "Max Items",
        default: 10,
        min: 1,
        max: 50,
      } as ConfigField,
    },
    outputDescription: "Array of feed items with title, link, description, pubDate",
    rateLimit: 20,
  },
  async (input) => {
    const { url, max = 10 } = input as { url: string; max?: number };

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; ControlDeck/1.0)",
          "Accept": "application/rss+xml, application/xml, text/xml, */*",
        },
      });

      if (!response.ok) {
        throw new Error(`Feed fetch failed: ${response.status}`);
      }

      const text = await response.text();
      const items = parseRssFeed(text, max);
      
      return {
        success: true,
        data: { items },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Feed fetch failed",
      };
    }
  }
);

// --- sports.scores ---
registerTool(
  "sports.scores",
  {
    name: "Sports Scores",
    description: "Get recent match scores for a team or league",
    inputSchema: {
      team: {
        type: "string",
        label: "Team Name",
        description: "Team name to search for (e.g., 'Arsenal', 'Liverpool')",
      } as ConfigField,
      league: {
        type: "string",
        label: "League",
        default: "premier_league",
        options: ["premier_league", "la_liga", "bundesliga", "serie_a", "ligue_1", "champions_league"],
      } as ConfigField,
      days: {
        type: "number",
        label: "Days Back",
        default: 7,
        min: 1,
        max: 30,
      } as ConfigField,
    },
    outputDescription: "Array of matches with teams, scores, date, status",
    rateLimit: 10,
  },
  async (input) => {
    const { team, league = "premier_league", days = 7 } = input as {
      team?: string;
      league?: string;
      days?: number;
    };

    try {
      // Use web search to find scores (simple approach)
      // In production, would use a dedicated sports API like API-Football
      const query = team 
        ? `${team} football match results last ${days} days score`
        : `${league.replace(/_/g, " ")} results scores`;
      
      const params = new URLSearchParams({ q: query, max: "10" });
      const response = await fetch(`${DECK_BASE_URL}/api/search?${params}`);
      
      if (!response.ok) {
        throw new Error(`Sports search failed: ${response.status}`);
      }

      const data = await response.json();
      
      // Parse scores from search results
      const matches = parseScoresFromSearchResults(data.results || [], team);
      
      return {
        success: true,
        data: { matches },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Sports fetch failed",
      };
    }
  }
);

// --- news.headlines ---
registerTool(
  "news.headlines",
  {
    name: "News Headlines",
    description: "Get recent news headlines on a topic",
    inputSchema: {
      query: {
        type: "string",
        label: "Topic",
        description: "News topic or keywords",
        required: true,
      } as ConfigField,
      category: {
        type: "string",
        label: "Category",
        default: "general",
        options: ["general", "tech", "sports", "business", "science", "entertainment"],
      } as ConfigField,
      max: {
        type: "number",
        label: "Max Headlines",
        default: 10,
        min: 1,
        max: 20,
      } as ConfigField,
    },
    outputDescription: "Array of headlines with title, source, url, time",
    rateLimit: 10,
  },
  async (input) => {
    const { query, category = "general", max = 10 } = input as {
      query: string;
      category?: string;
      max?: number;
    };

    try {
      const searchQuery = category !== "general" 
        ? `${query} ${category} news`
        : `${query} news`;
      
      const params = new URLSearchParams({
        q: searchQuery,
        max: String(max),
        recency: "24h",
      });
      
      const response = await fetch(`${DECK_BASE_URL}/api/search?${params}`);
      
      if (!response.ok) {
        throw new Error(`News search failed: ${response.status}`);
      }

      const data = await response.json();
      
      const headlines = (data.results || []).map((r: Record<string, unknown>) => ({
        title: r.title,
        source: extractSource(r.url as string),
        url: r.url,
        snippet: r.snippet,
        time: r.time || "recent",
      }));
      
      return {
        success: true,
        data: { headlines },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "News fetch failed",
      };
    }
  }
);

// --- weather.current ---
registerTool(
  "weather.current",
  {
    name: "Current Weather",
    description: "Get current weather for a location",
    inputSchema: {
      location: {
        type: "string",
        label: "Location",
        description: "City name or coordinates",
        required: true,
      } as ConfigField,
    },
    outputDescription: "Weather data with temp, conditions, humidity, wind",
    rateLimit: 20,
  },
  async (input) => {
    const { location } = input as { location: string };

    try {
      // Use the existing weather widget API
      const response = await fetch(`${DECK_BASE_URL}/api/widgets/weather?location=${encodeURIComponent(location)}`);
      
      if (!response.ok) {
        // Fallback to web search
        const searchResp = await fetch(`${DECK_BASE_URL}/api/search?q=${encodeURIComponent(`weather ${location}`)}&max=3`);
        if (!searchResp.ok) {
          throw new Error("Weather fetch failed");
        }
        const searchData = await searchResp.json();
        return {
          success: true,
          data: {
            location,
            source: "search",
            results: searchData.results,
          },
        };
      }

      const data = await response.json();
      return {
        success: true,
        data,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Weather fetch failed",
      };
    }
  }
);

// --- github.activity ---
registerTool(
  "github.activity",
  {
    name: "GitHub Activity",
    description: "Get recent activity from a GitHub repository",
    inputSchema: {
      repo: {
        type: "string",
        label: "Repository",
        description: "Repository in owner/repo format",
        required: true,
      } as ConfigField,
      type: {
        type: "string",
        label: "Activity Type",
        default: "all",
        options: ["all", "issues", "pulls", "commits", "releases"],
      } as ConfigField,
      max: {
        type: "number",
        label: "Max Items",
        default: 10,
        min: 1,
        max: 50,
      } as ConfigField,
    },
    outputDescription: "Array of activity items with type, title, url, author, date",
    rateLimit: 30,
  },
  async (input) => {
    const { repo, type = "all", max = 10 } = input as {
      repo: string;
      type?: string;
      max?: number;
    };

    try {
      const [owner, repoName] = repo.split("/");
      if (!owner || !repoName) {
        throw new Error("Invalid repo format. Use owner/repo");
      }

      const activities: Array<Record<string, unknown>> = [];
      const headers = {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "ControlDeck/1.0",
      };

      // Fetch based on type
      if (type === "all" || type === "issues") {
        const resp = await fetch(
          `https://api.github.com/repos/${owner}/${repoName}/issues?state=all&per_page=${max}`,
          { headers }
        );
        if (resp.ok) {
          const issues = await resp.json();
          activities.push(...issues.map((i: Record<string, unknown>) => ({
            type: i.pull_request ? "pull" : "issue",
            title: i.title,
            url: i.html_url,
            author: (i.user as Record<string, unknown>)?.login,
            date: i.created_at,
            state: i.state,
            number: i.number,
          })));
        }
      }

      if (type === "all" || type === "commits") {
        const resp = await fetch(
          `https://api.github.com/repos/${owner}/${repoName}/commits?per_page=${max}`,
          { headers }
        );
        if (resp.ok) {
          const commits = await resp.json();
          activities.push(...commits.map((c: Record<string, unknown>) => ({
            type: "commit",
            title: (c.commit as Record<string, unknown>)?.message,
            url: c.html_url,
            author: (c.author as Record<string, unknown>)?.login || 
                   ((c.commit as Record<string, unknown>)?.author as Record<string, unknown>)?.name,
            date: ((c.commit as Record<string, unknown>)?.author as Record<string, unknown>)?.date,
            sha: (c.sha as string)?.slice(0, 7),
          })));
        }
      }

      if (type === "all" || type === "releases") {
        const resp = await fetch(
          `https://api.github.com/repos/${owner}/${repoName}/releases?per_page=${max}`,
          { headers }
        );
        if (resp.ok) {
          const releases = await resp.json();
          activities.push(...releases.map((r: Record<string, unknown>) => ({
            type: "release",
            title: r.name || r.tag_name,
            url: r.html_url,
            author: (r.author as Record<string, unknown>)?.login,
            date: r.published_at,
            tag: r.tag_name,
          })));
        }
      }

      // Sort by date and limit
      activities.sort((a, b) => {
        const dateA = new Date(a.date as string).getTime();
        const dateB = new Date(b.date as string).getTime();
        return dateB - dateA;
      });

      return {
        success: true,
        data: {
          repo,
          activities: activities.slice(0, max),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "GitHub fetch failed",
      };
    }
  }
);

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Simple RSS/Atom feed parser
 */
function parseRssFeed(xml: string, maxItems: number): Array<Record<string, unknown>> {
  const items: Array<Record<string, unknown>> = [];
  
  // Try RSS 2.0 format first
  const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/gi);
  for (const match of itemMatches) {
    if (items.length >= maxItems) break;
    
    const itemXml = match[1];
    const title = extractXmlTag(itemXml, "title");
    const link = extractXmlTag(itemXml, "link");
    const description = extractXmlTag(itemXml, "description");
    const pubDate = extractXmlTag(itemXml, "pubDate");
    
    if (title || link) {
      items.push({
        title: cleanHtml(title),
        link,
        description: cleanHtml(description),
        pubDate,
      });
    }
  }
  
  // Try Atom format if no items found
  if (items.length === 0) {
    const entryMatches = xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi);
    for (const match of entryMatches) {
      if (items.length >= maxItems) break;
      
      const entryXml = match[1];
      const title = extractXmlTag(entryXml, "title");
      const linkMatch = entryXml.match(/<link[^>]*href="([^"]*)"[^>]*\/>/);
      const link = linkMatch?.[1] || extractXmlTag(entryXml, "link");
      const summary = extractXmlTag(entryXml, "summary") || extractXmlTag(entryXml, "content");
      const published = extractXmlTag(entryXml, "published") || extractXmlTag(entryXml, "updated");
      
      if (title || link) {
        items.push({
          title: cleanHtml(title),
          link,
          description: cleanHtml(summary),
          pubDate: published,
        });
      }
    }
  }
  
  return items;
}

function extractXmlTag(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, "i")) ||
                xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1]?.trim() || "";
}

function cleanHtml(text: string): string {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function extractSource(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, "").split(".")[0];
  } catch {
    return "unknown";
  }
}

/**
 * Parse sports scores from search results
 * This is a simple heuristic approach - a proper sports API would be better
 */
function parseScoresFromSearchResults(
  results: Array<Record<string, unknown>>,
  teamFilter?: string
): Array<Record<string, unknown>> {
  const matches: Array<Record<string, unknown>> = [];
  const scorePattern = /(\w[\w\s]+?)\s+(\d+)\s*[-–:]\s*(\d+)\s+(\w[\w\s]+)/gi;
  
  for (const result of results) {
    const text = `${result.title} ${result.snippet}`;
    let match;
    
    while ((match = scorePattern.exec(text)) !== null) {
      const [, team1, score1, score2, team2] = match;
      
      // Filter by team if specified
      if (teamFilter) {
        const filter = teamFilter.toLowerCase();
        if (!team1.toLowerCase().includes(filter) && 
            !team2.toLowerCase().includes(filter)) {
          continue;
        }
      }
      
      matches.push({
        homeTeam: team1.trim(),
        awayTeam: team2.trim(),
        homeScore: parseInt(score1),
        awayScore: parseInt(score2),
        source: result.url,
        status: "finished",
      });
    }
  }
  
  // Dedupe by team names
  const seen = new Set<string>();
  return matches.filter(m => {
    const key = `${m.homeTeam}-${m.awayTeam}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
