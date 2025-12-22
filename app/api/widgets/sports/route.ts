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
  try {
    // ESPN has a public scoreboard API
    const res = await fetch(
      "https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard",
      {
        headers: { "User-Agent": "Control-Deck/1.0" },
        next: { revalidate: 120 },
      }
    );
    
    if (!res.ok) throw new Error("ESPN API error");
    
    const data = await res.json();
    const scores: SportScore[] = [];
    
    for (const event of (data.events || []).slice(0, 5)) {
      const competition = event.competitions?.[0];
      if (!competition) continue;
      
      const homeTeam = competition.competitors?.find((c: { homeAway: string }) => c.homeAway === "home");
      const awayTeam = competition.competitors?.find((c: { homeAway: string }) => c.homeAway === "away");
      
      if (!homeTeam || !awayTeam) continue;
      
      let status: SportScore["status"] = "upcoming";
      if (event.status?.type?.completed) {
        status = "final";
      } else if (event.status?.type?.state === "in") {
        status = "live";
      }
      
      scores.push({
        id: event.id,
        league: "EPL",
        homeTeam: homeTeam.team?.abbreviation || homeTeam.team?.shortDisplayName || "HOME",
        awayTeam: awayTeam.team?.abbreviation || awayTeam.team?.shortDisplayName || "AWAY",
        homeScore: parseInt(homeTeam.score) || 0,
        awayScore: parseInt(awayTeam.score) || 0,
        status,
        time: status === "live" ? event.status?.displayClock : undefined,
        startTime: status === "upcoming" ? formatStartTime(event.date) : undefined,
      });
    }
    
    return scores;
  } catch (error) {
    console.error("[Sports Widget] ESPN fetch failed:", error);
    return [];
  }
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
