import { NextResponse } from "next/server";
import type { SportsData, SportScore } from "@/lib/widgets/types";

// Cache sports for 2 minutes (live scores update frequently)
let cache: { data: SportsData; timestamp: number } | null = null;
const CACHE_TTL = 2 * 60 * 1000;

// Fallback mock data when API is unavailable
const MOCK_SCORES: SportScore[] = [
  {
    id: "1",
    league: "EPL",
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    homeScore: 2,
    awayScore: 1,
    status: "final",
  },
  {
    id: "2", 
    league: "EPL",
    homeTeam: "Man City",
    awayTeam: "Liverpool",
    homeScore: 0,
    awayScore: 0,
    status: "upcoming",
    startTime: "Tomorrow 3PM",
  },
  {
    id: "3",
    league: "NBA",
    homeTeam: "Lakers",
    awayTeam: "Celtics",
    homeScore: 112,
    awayScore: 108,
    status: "final",
  },
];

async function fetchESPNScores(): Promise<SportScore[]> {
  const scores: SportScore[] = [];
  
  try {
    // Fetch current scoreboard (live + upcoming)
    const scoreboardRes = await fetch(
      "https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard",
      {
        headers: { "User-Agent": "Control-Deck/1.0" },
        next: { revalidate: 120 },
      }
    );
    
    if (scoreboardRes.ok) {
      const data = await scoreboardRes.json();
      
      for (const event of (data.events || []).slice(0, 5)) {
        const score = parseESPNEvent(event);
        if (score) scores.push(score);
      }
    }
  } catch (error) {
    console.error("[Sports Widget] ESPN scoreboard fetch failed:", error);
  }
  
  // Also fetch Arsenal's recent results specifically
  try {
    const arsenalRes = await fetch(
      "https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/teams/359/schedule",
      {
        headers: { "User-Agent": "Control-Deck/1.0" },
        next: { revalidate: 300 },
      }
    );
    
    if (arsenalRes.ok) {
      const data = await arsenalRes.json();
      const events = data.events || [];
      
      // Get last 3 completed Arsenal matches
      const completedMatches = events
        .filter((e: Record<string, unknown>) => {
          const comp = (e.competitions as Array<Record<string, unknown>>)?.[0];
          const statusType = (comp?.status as Record<string, unknown>)?.type as Record<string, unknown> | undefined;
          return statusType?.completed === true;
        })
        .slice(-3);
      
      console.log(`[Sports Widget] Found ${completedMatches.length} completed Arsenal matches`);
      
      for (const event of completedMatches) {
        const score = parseESPNEvent(event as Record<string, unknown>, true);
        if (score) {
          score.status = "final"; // Force status since we filtered for completed
          // Remove any existing entry with same ID and add to front
          const existingIdx = scores.findIndex(s => s.id === score.id);
          if (existingIdx >= 0) scores.splice(existingIdx, 1);
          scores.unshift(score);
        }
      }
    }
  } catch (error) {
    console.error("[Sports Widget] Arsenal schedule fetch failed:", error);
  }
  
  return scores;
}

interface ESPNScore {
  value?: number;
  displayValue?: string;
}

interface ESPNCompetitor {
  homeAway: string;
  team?: { abbreviation?: string; shortDisplayName?: string };
  score?: string | ESPNScore;
}

function parseScore(score: string | ESPNScore | undefined): number {
  if (!score) return 0;
  if (typeof score === "string") return parseInt(score) || 0;
  if (typeof score === "object") {
    if (score.displayValue) return parseInt(score.displayValue) || 0;
    if (score.value !== undefined) return Math.floor(score.value);
  }
  return 0;
}

function parseESPNEvent(event: Record<string, unknown>, isArsenal = false): SportScore | null {
  const competition = (event.competitions as Array<Record<string, unknown>>)?.[0];
  if (!competition) return null;
  
  const competitors = competition.competitors as ESPNCompetitor[];
  const homeTeam = competitors?.find((c) => c.homeAway === "home");
  const awayTeam = competitors?.find((c) => c.homeAway === "away");
  
  if (!homeTeam || !awayTeam) return null;
  
  const statusType = (event.status as Record<string, unknown>)?.type as Record<string, unknown> | undefined;
  const statusState = statusType?.state as string | undefined;
  
  let status: SportScore["status"] = "upcoming";
  if (statusType?.completed) {
    status = "final";
  } else if (statusState === "in") {
    status = "live";
  }
  
  return {
    id: String(event.id),
    league: "EPL",
    homeTeam: homeTeam.team?.abbreviation || homeTeam.team?.shortDisplayName || "HOME",
    awayTeam: awayTeam.team?.abbreviation || awayTeam.team?.shortDisplayName || "AWAY",
    homeScore: parseScore(homeTeam.score),
    awayScore: parseScore(awayTeam.score),
    status,
    time: status === "live" ? String((event.status as Record<string, unknown>)?.displayClock || "") : undefined,
    startTime: status === "upcoming" ? formatStartTime(String(event.date)) : undefined,
    highlight: isArsenal,
  };
}

function formatStartTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) {
    return `Today ${date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  } else if (diffDays === 1) {
    return `Tomorrow ${date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  } else {
    return date.toLocaleDateString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
  }
}

export async function GET() {
  // Check cache
  if (cache && Date.now() - cache.timestamp < CACHE_TTL) {
    return NextResponse.json(cache.data);
  }

  try {
    let scores = await fetchESPNScores();
    
    // Use mock data if API returns nothing
    if (scores.length === 0) {
      scores = MOCK_SCORES;
    }
    
    const sports: SportsData = {
      scores,
      updatedAt: new Date().toISOString(),
    };

    cache = { data: sports, timestamp: Date.now() };
    return NextResponse.json(sports);
  } catch (error) {
    console.error("[Sports Widget] Error:", error);
    
    if (cache) {
      return NextResponse.json(cache.data);
    }
    
    // Return mock data as fallback
    return NextResponse.json({
      scores: MOCK_SCORES,
      updatedAt: new Date().toISOString(),
    });
  }
}
