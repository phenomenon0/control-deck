import { NextRequest, NextResponse } from "next/server";

// =============================================================================
// Types
// =============================================================================

interface SportsScoreData {
  homeTeam: { name: string; shortName?: string; score?: number };
  awayTeam: { name: string; shortName?: string; score?: number };
  status: "scheduled" | "live" | "finished" | "postponed";
  competition?: string;
  venue?: string;
  date?: string;
  time?: string;
  scorers?: { player: string; minute: number; team: "home" | "away" }[];
}

interface WeatherData {
  location: string;
  temperature: number;
  feelsLike?: number;
  condition: string;
  humidity?: number;
  windSpeed?: number;
  high?: number;
  low?: number;
  forecast?: { day: string; high: number; low: number; condition: string }[];
}

type CardData = 
  | { type: "sports"; data: SportsScoreData }
  | { type: "weather"; data: WeatherData };

// =============================================================================
// Sports Score Parsing
// =============================================================================

// Common team name mappings
const TEAM_ALIASES: Record<string, string> = {
  "man utd": "Manchester United",
  "man united": "Manchester United",
  "united": "Manchester United",
  "man city": "Manchester City",
  "city": "Manchester City",
  "spurs": "Tottenham",
  "villa": "Aston Villa",
  "wolves": "Wolverhampton",
  "newcastle utd": "Newcastle",
  "west ham utd": "West Ham",
  "nottm forest": "Nottingham Forest",
  "nott'm forest": "Nottingham Forest",
  "forest": "Nottingham Forest",
  "palace": "Crystal Palace",
};

function normalizeTeamName(name: string): string {
  const lower = name.toLowerCase().trim();
  return TEAM_ALIASES[lower] || name.trim();
}

// Parse score from text like "2-1", "2 - 1", "2:1"
function parseScore(text: string): { home: number; away: number } | null {
  const match = text.match(/(\d+)\s*[-:]\s*(\d+)/);
  if (match) {
    return { home: parseInt(match[1]), away: parseInt(match[2]) };
  }
  return null;
}

// List of known team names for better matching
const KNOWN_TEAMS = [
  "arsenal", "aston villa", "bournemouth", "brentford", "brighton", "chelsea",
  "crystal palace", "everton", "fulham", "ipswich", "leicester", "liverpool",
  "manchester city", "manchester united", "man city", "man united", "man utd",
  "newcastle", "newcastle united", "nottingham forest", "nottm forest", "southampton", 
  "tottenham", "tottenham hotspur", "spurs", "west ham", "west ham united", "wolves", "wolverhampton",
  "barcelona", "real madrid", "bayern munich", "bayern", "psg", "paris saint-germain",
  "juventus", "inter milan", "ac milan", "atletico madrid"
];

function findTeamInText(text: string): string | null {
  const lower = text.toLowerCase();
  for (const team of KNOWN_TEAMS) {
    if (lower.includes(team)) {
      return normalizeTeamName(team);
    }
  }
  return null;
}

// Extract sports data from search results
// STRICT MODE: Only extract when we have high confidence
function parseSportsFromSearch(query: string, results: { title: string; snippet: string; url: string }[]): SportsScoreData | null {
  // First try to identify teams from the query
  const queryTeams: string[] = [];
  const qLower = query.toLowerCase();
  for (const team of KNOWN_TEAMS) {
    if (qLower.includes(team)) {
      queryTeams.push(team); // Keep original for matching
    }
  }
  
  // If no team in query, don't try to parse (too risky)
  if (queryTeams.length === 0) {
    return null;
  }
  
  // Only look at titles - they're most reliable
  // Pattern: "Team A X-X Team B" in title
  for (const result of results) {
    const title = result.title;
    const titleLower = title.toLowerCase();
    
    // Must contain query team
    const queryTeamInTitle = queryTeams.some(t => titleLower.includes(t));
    if (!queryTeamInTitle) continue;
    
    // Look for strict "Team X-X Team" pattern in title only
    const scoreData = extractStrictScore(title, queryTeams);
    if (scoreData) {
      return scoreData;
    }
  }
  
  return null;
}

// Strict score extraction - only from clear "TeamA X-X TeamB" patterns
function extractStrictScore(title: string, queryTeams: string[]): SportsScoreData | null {
  const titleLower = title.toLowerCase();
  
  // Pattern: "Team A X-X Team B" where X-X is the score
  // Examples: "Liverpool 3-0 Nottingham Forest", "Tottenham Hotspur 1-2 Liverpool"
  for (const team1 of KNOWN_TEAMS) {
    // Escape special chars in team name for regex
    const team1Escaped = team1.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // Match: team1 followed by score followed by another team
    const pattern = new RegExp(
      `(${team1Escaped})\\s+(\\d+)\\s*[-–:]\\s*(\\d+)\\s+([a-z][a-z\\s]*?)(?:\\s*[:\\|,]|$)`,
      "i"
    );
    
    const match = title.match(pattern);
    if (match) {
      const homeTeamRaw = match[1].trim();
      const homeScore = parseInt(match[2]);
      const awayScore = parseInt(match[3]);
      const awayText = match[4].trim().toLowerCase();
      
      // Find away team in the matched text
      const awayTeam = KNOWN_TEAMS.find(t => awayText.startsWith(t) || awayText.includes(t));
      if (awayTeam) {
        // Verify one of the teams is from the query
        const homeNorm = normalizeTeamName(homeTeamRaw);
        const awayNorm = normalizeTeamName(awayTeam);
        const queryTeamMatch = queryTeams.some(qt => 
          homeNorm.toLowerCase().includes(qt) || awayNorm.toLowerCase().includes(qt)
        );
        
        if (queryTeamMatch) {
          return createSportsCard(homeNorm, awayNorm, homeScore, awayScore, titleLower);
        }
      }
    }
  }
  
  return null;
}

// Keep old function for reference but not used
function extractScoreFromText(text: string, queryTeams: string[]): SportsScoreData | null {
  const textLower = text.toLowerCase();
  
  // Pattern 1: "Team A 2-1 Team B" (common in titles)
  // Match team names followed by score followed by team name
  for (const homeTeam of KNOWN_TEAMS) {
    const homeNorm = normalizeTeamName(homeTeam);
    const pattern = new RegExp(`${homeTeam}\\s*(\\d+)\\s*[-:–]\\s*(\\d+)\\s+([a-z\\s]+)`, "i");
    const match = text.match(pattern);
    if (match) {
      const awayText = match[3].trim().toLowerCase();
      const awayTeam = KNOWN_TEAMS.find(t => awayText.includes(t));
      if (awayTeam) {
        return createSportsCard(homeNorm, normalizeTeamName(awayTeam), parseInt(match[1]), parseInt(match[2]), textLower);
      }
    }
  }
  
  // Pattern 2: Generic "X-X" with teams in context
  const scoreMatch = text.match(/\b(\d+)\s*[-:–]\s*(\d+)\b/);
  if (scoreMatch && queryTeams.length >= 1) {
    let homeTeam = queryTeams[0];
    let awayTeam = queryTeams[1];
    
    // If only one team in query, try to find opponent
    if (!awayTeam) {
      for (const team of KNOWN_TEAMS) {
        if (textLower.includes(team) && normalizeTeamName(team) !== homeTeam) {
          awayTeam = normalizeTeamName(team);
          break;
        }
      }
    }
    
    if (homeTeam && awayTeam) {
      // Check ordering: look for "A vs B" or "A X-X B" patterns
      const homeIdx = textLower.indexOf(homeTeam.toLowerCase());
      const awayIdx = textLower.indexOf(awayTeam.toLowerCase());
      const scoreIdx = text.indexOf(scoreMatch[0]);
      
      // If away team appears before score and home after, swap
      if (awayIdx < scoreIdx && homeIdx > scoreIdx) {
        [homeTeam, awayTeam] = [awayTeam, homeTeam];
      }
      // If "X vs Y" pattern, X is usually home
      if (textLower.includes(`${awayTeam.toLowerCase()} vs ${homeTeam.toLowerCase()}`)) {
        [homeTeam, awayTeam] = [awayTeam, homeTeam];
      }
      
      return createSportsCard(homeTeam, awayTeam, parseInt(scoreMatch[1]), parseInt(scoreMatch[2]), textLower);
    }
  }
  
  // Pattern 3: "beat/defeated ... X-X"
  const beatMatch = text.match(/(beat|defeated|won over|win over|win against)\s+([a-z\s]+?)\s*(\d+)\s*[-:–]\s*(\d+)/i);
  if (beatMatch) {
    const winnerTeam = findTeamInText(text.split(beatMatch[0])[0]) || queryTeams[0];
    const loserText = beatMatch[2].trim().toLowerCase();
    const loserTeam = KNOWN_TEAMS.find(t => loserText.includes(t));
    if (winnerTeam && loserTeam) {
      return createSportsCard(winnerTeam, normalizeTeamName(loserTeam), parseInt(beatMatch[3]), parseInt(beatMatch[4]), textLower);
    }
  }
  
  return null;
}

function createSportsCard(homeTeam: string, awayTeam: string, homeScore: number, awayScore: number, textLower: string): SportsScoreData {
  // Determine status - default to finished if we have scores
  let status: SportsScoreData["status"] = "finished";
  
  // Only mark as live if explicitly stated (not just "live" in URL)
  if ((textLower.includes("live:") || textLower.includes("live -") || textLower.includes("- live")) && 
      !textLower.includes("beat") && !textLower.includes("won") && !textLower.includes("defeat")) {
    status = "live";
  } else if (textLower.includes("postponed")) {
    status = "postponed";
  } else if ((textLower.includes("upcoming") || textLower.includes("kickoff") || textLower.includes("preview")) &&
             !textLower.includes("beat") && !textLower.includes("won")) {
    status = "scheduled";
  }
  // If text contains "beat", "won", "defeat", "hold on" - it's finished
  if (textLower.includes("beat") || textLower.includes("won") || textLower.includes("defeat") || 
      textLower.includes("hold on") || textLower.includes("victory")) {
    status = "finished";
  }
  
  // Try to extract competition
  let competition = "Football";
  if (textLower.includes("premier league")) competition = "Premier League";
  else if (textLower.includes("la liga")) competition = "La Liga";
  else if (textLower.includes("champions league")) competition = "Champions League";
  else if (textLower.includes("europa league")) competition = "Europa League";
  else if (textLower.includes("fa cup")) competition = "FA Cup";
  else if (textLower.includes("efl cup") || textLower.includes("carabao")) competition = "EFL Cup";
  else if (textLower.includes("serie a")) competition = "Serie A";
  else if (textLower.includes("bundesliga")) competition = "Bundesliga";
  
  return {
    homeTeam: { name: homeTeam, score: homeScore },
    awayTeam: { name: awayTeam, score: awayScore },
    status,
    competition,
  };
}

// =============================================================================
// Weather Parsing
// =============================================================================

function parseWeatherFromSearch(query: string, results: { title: string; snippet: string; url: string }[]): WeatherData | null {
  // Extract location from query
  const locationMatch = query.match(/weather\s+(?:in\s+)?([a-z\s,]+)/i);
  const location = locationMatch ? locationMatch[1].trim() : "Unknown";
  
  for (const result of results) {
    const text = `${result.title} ${result.snippet}`;
    
    // Look for temperature patterns - be more specific to avoid matching dates/other numbers
    // Pattern: "X°C", "XC", "X degrees", "highs of X", "temperatures of X"
    const tempPatterns = [
      /(\d{1,2})\s*°\s*[Cc]/,  // 5°C
      /(\d{1,2})\s*degrees?\s*[Cc]/i,  // 5 degrees C
      /highs?\s+(?:of\s+)?(\d{1,2})\s*°?[Cc]?/i,  // highs of 5
      /temperatures?\s+(?:of\s+)?(\d{1,2})\s*°?[Cc]?/i,  // temperatures of 5
      /(\d{1,2})\s*[-–]\s*(\d{1,2})\s*°?[Cc]/,  // 5-7°C (range)
    ];
    
    let temp: number | null = null;
    let high: number | undefined;
    let low: number | undefined;
    
    for (const pattern of tempPatterns) {
      const match = text.match(pattern);
      if (match) {
        if (match[2]) {
          // It's a range
          low = parseInt(match[1]);
          high = parseInt(match[2]);
          temp = Math.round((low + high) / 2);
        } else {
          temp = parseInt(match[1]);
        }
        break;
      }
    }
    
    // Also try high/low separately
    const highMatch = text.match(/highs?\s+(?:of\s+)?(\d{1,2})/i);
    const lowMatch = text.match(/lows?\s+(?:of\s+)?(\d{1,2})/i);
    if (highMatch && !high) high = parseInt(highMatch[1]);
    if (lowMatch && !low) low = parseInt(lowMatch[1]);
    
    // If we found temp or can derive it
    if (temp !== null || (high !== undefined && low !== undefined)) {
      if (temp === null && high !== undefined && low !== undefined) {
        temp = Math.round((high + low) / 2);
      }
      
      // Extract condition
      let condition = "Unknown";
      const conditionPatterns = [
        { pattern: /sunny|clear\s+sk/i, value: "Sunny" },
        { pattern: /partly cloudy/i, value: "Partly Cloudy" },
        { pattern: /cloudy|overcast/i, value: "Cloudy" },
        { pattern: /rain|rainy|showers|wet/i, value: "Rainy" },
        { pattern: /storm|thunder/i, value: "Stormy" },
        { pattern: /snow|wintry|freezing/i, value: "Snowy" },
        { pattern: /fog|mist/i, value: "Foggy" },
        { pattern: /wind/i, value: "Windy" },
        { pattern: /mild/i, value: "Mild" },
      ];
      
      for (const { pattern, value } of conditionPatterns) {
        if (pattern.test(text)) {
          condition = value;
          break;
        }
      }
      
      // Try to extract humidity
      const humidityMatch = text.match(/humidity[:\s]+(\d+)/i);
      const humidity = humidityMatch ? parseInt(humidityMatch[1]) : undefined;
      
      // Try to extract wind
      const windMatch = text.match(/wind[:\s]+(\d+)/i);
      const windSpeed = windMatch ? parseInt(windMatch[1]) : undefined;
      
      return {
        location: location.charAt(0).toUpperCase() + location.slice(1),
        temperature: temp!,
        condition,
        humidity,
        windSpeed,
        high,
        low,
      };
    }
  }
  
  return null;
}

// =============================================================================
// Query Classification
// =============================================================================

function classifyQuery(query: string): "sports" | "weather" | "unknown" {
  const q = query.toLowerCase();
  
  // Weather patterns
  if (/weather|temperature|forecast|humidity|rain|sunny|cloudy/.test(q)) {
    return "weather";
  }
  
  // Sports patterns
  if (/score|result|match|game|vs|versus|played|won|lost|beat|defeated|standings|fixture/.test(q)) {
    return "sports";
  }
  
  // Team names
  const teams = ["arsenal", "chelsea", "liverpool", "manchester", "tottenham", "villa", "newcastle", "everton", "wolves", "brighton", "fulham", "brentford", "bournemouth", "palace", "forest", "barcelona", "real madrid", "bayern"];
  if (teams.some(team => q.includes(team))) {
    return "sports";
  }
  
  return "unknown";
}

// =============================================================================
// API Handler
// =============================================================================

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q");
  
  if (!query) {
    return NextResponse.json({ error: "Missing query parameter 'q'" }, { status: 400 });
  }
  
  const queryType = classifyQuery(query);
  
  // Fetch search results
  try {
    const searchRes = await fetch(`http://localhost:3333/api/search?q=${encodeURIComponent(query)}&max=5`);
    if (!searchRes.ok) {
      return NextResponse.json({ query, cards: [], type: queryType });
    }
    
    const searchData = await searchRes.json();
    const results = searchData.results || [];
    
    const cards: CardData[] = [];
    
    if (queryType === "sports") {
      const sportsData = parseSportsFromSearch(query, results);
      if (sportsData) {
        cards.push({ type: "sports", data: sportsData });
      }
    } else if (queryType === "weather") {
      const weatherData = parseWeatherFromSearch(query, results);
      if (weatherData) {
        cards.push({ type: "weather", data: weatherData });
      }
    }
    
    return NextResponse.json({
      query,
      queryType,
      cards,
      searchResults: results,
    });
  } catch (error) {
    console.error("[Cards API] Error:", error);
    return NextResponse.json({ query, cards: [], error: "Search failed" });
  }
}

// POST handler for direct card data
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    
    // Allow direct card creation
    if (body.type && body.data) {
      return NextResponse.json({
        cards: [{ type: body.type, data: body.data }],
      });
    }
    
    // Otherwise process query
    const { query } = body;
    if (!query) {
      return NextResponse.json({ error: "Missing query" }, { status: 400 });
    }
    
    // Redirect to GET handler logic
    const url = new URL(req.url);
    url.searchParams.set("q", query);
    const getReq = new NextRequest(url);
    return GET(getReq);
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}
