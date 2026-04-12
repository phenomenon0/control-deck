import type { Artifact } from "@/components/chat/ArtifactRenderer";

// Types
export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  artifacts?: Artifact[];
  // Info cards (sports scores, weather, etc.)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cards?: Array<{ type: "sports" | "weather" | "info"; data: any }>;
}

export interface Thread {
  id: string;
  title: string;
  lastMessageAt: string;
}

// localStorage keys
export const THREADS_KEY = "deck:threads";
export const ACTIVE_THREAD_KEY = "deck:activeThread";

export function getStoredThreads(): Thread[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(THREADS_KEY) || "[]");
  } catch {
    return [];
  }
}

export function setStoredThreads(threads: Thread[]) {
  localStorage.setItem(THREADS_KEY, JSON.stringify(threads));
}

export function getStoredActiveThread(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACTIVE_THREAD_KEY);
}

export function setStoredActiveThread(id: string | null) {
  if (id) localStorage.setItem(ACTIVE_THREAD_KEY, id);
  else localStorage.removeItem(ACTIVE_THREAD_KEY);
}

export function shouldSearch(query: string): boolean {
  const q = query.toLowerCase();
  if (/\b(search|look up|find online|google|bing|browse)\b/.test(q)) return true;
  if (/\b(latest|recent|current|today|yesterday|this week|this month|right now|currently|last)\b/.test(q)) return true;
  if (/\b(202[3-9]|203\d)\b/.test(q)) return true;
  if (/\b(news|update|announcement|released|launched|happened|breaking|trending)\b/.test(q)) return true;
  if (/\b(price|stock|weather|score|result|winner|election|status|rate|cost|match|game|played|vs)\b/.test(q)) return true;
  return false;
}

// Known team names for extraction
export const KNOWN_TEAMS = [
  "arsenal", "aston villa", "bournemouth", "brentford", "brighton", "chelsea",
  "crystal palace", "everton", "fulham", "ipswich", "leicester", "liverpool",
  "manchester city", "manchester united", "man city", "man united", "man utd",
  "newcastle", "nottingham forest", "southampton", "tottenham", "west ham", "wolves",
  "barcelona", "real madrid", "bayern munich", "bayern", "psg", "juventus",
  "inter milan", "ac milan", "atletico madrid"
];

// Extract sports score from LLM response text
export function extractSportsCard(text: string): { type: "sports"; data: unknown } | null {
  const textLower = text.toLowerCase();

  // Pattern: "Team A X-X Team B" or "Team A beat Team B X-X"
  // Look for score pattern with ** markdown (common in responses)
  const scorePatterns = [
    /\*\*([a-z\s]+?)\s+(\d+)\s*[-–:]\s*(\d+)\s+([a-z\s]+?)\*\*/i,  // **Liverpool 3-0 Forest**
    /\*\*(\d+)\s*[-–:]\s*(\d+)\*\*.*?([a-z\s]+?)\s+(?:vs?\.?|against|beat|defeated)\s+([a-z\s]+)/i,  // **3-0** Liverpool vs Forest
    /([a-z\s]+?)\s+(\d+)\s*[-–:]\s*(\d+)\s+([a-z\s]+?)(?:\.|,|$)/i,  // Liverpool 3-0 Forest.
  ];

  for (const pattern of scorePatterns) {
    const match = text.match(pattern);
    if (match) {
      let homeTeam: string, awayTeam: string, homeScore: number, awayScore: number;

      if (pattern === scorePatterns[1]) {
        // Pattern 2: score first, then teams
        homeScore = parseInt(match[1]);
        awayScore = parseInt(match[2]);
        homeTeam = match[3].trim();
        awayTeam = match[4].trim();
      } else {
        // Pattern 1 & 3: Team Score-Score Team
        homeTeam = match[1].trim();
        homeScore = parseInt(match[2]);
        awayScore = parseInt(match[3]);
        awayTeam = match[4].trim();
      }

      // Validate teams are known
      const homeKnown = KNOWN_TEAMS.some(t => homeTeam.toLowerCase().includes(t));
      const awayKnown = KNOWN_TEAMS.some(t => awayTeam.toLowerCase().includes(t));

      if (homeKnown || awayKnown) {
        // Determine competition from context
        let competition = "Football";
        if (textLower.includes("premier league")) competition = "Premier League";
        else if (textLower.includes("champions league")) competition = "Champions League";
        else if (textLower.includes("europa league")) competition = "Europa League";
        else if (textLower.includes("fa cup")) competition = "FA Cup";
        else if (textLower.includes("la liga")) competition = "La Liga";

        return {
          type: "sports",
          data: {
            homeTeam: { name: homeTeam, score: homeScore },
            awayTeam: { name: awayTeam, score: awayScore },
            status: "finished",
            competition,
          }
        };
      }
    }
  }

  return null;
}

// Extract weather from LLM response text
export function extractWeatherCard(text: string): { type: "weather"; data: unknown } | null {
  const textLower = text.toLowerCase();

  // Must mention weather-related terms
  if (!/(weather|temperature|degrees|°|forecast|sunny|cloudy|rain|snow)/i.test(text)) {
    return null;
  }

  // Extract temperature
  const tempMatch = text.match(/(\d+)\s*°?\s*([CF])?/i);
  if (!tempMatch) return null;

  let temp = parseInt(tempMatch[1]);
  // Convert F to C if likely Fahrenheit (>45 without unit specified often means F)
  if (tempMatch[2]?.toUpperCase() === 'F' || (temp > 45 && !tempMatch[2])) {
    temp = Math.round((temp - 32) * 5 / 9);
  }

  // Extract location
  const locationMatch = text.match(/(?:weather\s+(?:in|for)\s+|in\s+)([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
  const location = locationMatch ? locationMatch[1] : "Location";

  // Extract condition
  let condition = "Unknown";
  if (/sunny|clear/i.test(text)) condition = "Sunny";
  else if (/partly cloudy/i.test(text)) condition = "Partly Cloudy";
  else if (/cloud|overcast/i.test(text)) condition = "Cloudy";
  else if (/rain|shower/i.test(text)) condition = "Rainy";
  else if (/snow/i.test(text)) condition = "Snowy";
  else if (/storm|thunder/i.test(text)) condition = "Stormy";

  return {
    type: "weather",
    data: {
      location,
      temperature: temp,
      condition,
    }
  };
}

// Extract card from LLM response
export function extractCardFromResponse(text: string, query: string): { type: "sports" | "weather" | "info"; data: unknown } | null {
  const qLower = query.toLowerCase();

  // Check if sports-related query
  if (/score|match|game|played|vs|beat|won|lost|result/i.test(qLower) ||
      KNOWN_TEAMS.some(t => qLower.includes(t))) {
    const card = extractSportsCard(text);
    if (card) return card;
  }

  // Check if weather-related query
  if (/weather|temperature|forecast/i.test(qLower)) {
    const card = extractWeatherCard(text);
    if (card) return card;
  }

  return null;
}

// Helper to group threads by date
export function groupThreadsByDate(threads: Thread[]): { label: string; threads: Thread[] }[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const lastWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const lastMonth = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

  const groups: { label: string; threads: Thread[] }[] = [
    { label: "Today", threads: [] },
    { label: "Yesterday", threads: [] },
    { label: "Last 7 days", threads: [] },
    { label: "Last 30 days", threads: [] },
    { label: "Older", threads: [] },
  ];

  for (const t of threads) {
    const date = new Date(t.lastMessageAt);
    if (date >= today) {
      groups[0].threads.push(t);
    } else if (date >= yesterday) {
      groups[1].threads.push(t);
    } else if (date >= lastWeek) {
      groups[2].threads.push(t);
    } else if (date >= lastMonth) {
      groups[3].threads.push(t);
    } else {
      groups[4].threads.push(t);
    }
  }

  return groups.filter(g => g.threads.length > 0);
}
