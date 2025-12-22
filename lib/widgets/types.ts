/**
 * Widget Types - Shared types for all info widgets
 */

// Weather
export interface WeatherData {
  temp: number;
  feelsLike: number;
  condition: string;
  icon: "sun" | "cloud" | "rain" | "snow" | "storm" | "fog" | "partly-cloudy";
  humidity: number;
  wind: number;
  location: string;
  forecast: Array<{
    day: string;
    high: number;
    low: number;
    condition: string;
    icon: WeatherData["icon"];
  }>;
  updatedAt: string;
}

// News
export interface NewsItem {
  id: string;
  title: string;
  source: string;
  url: string;
  time: string;
  category: "ai" | "tech" | "science" | "general";
}

export interface NewsData {
  items: NewsItem[];
  updatedAt: string;
}

// Sports
export interface SportScore {
  id: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  status: "live" | "final" | "upcoming";
  time?: string;
  startTime?: string;
}

export interface SportsData {
  scores: SportScore[];
  updatedAt: string;
}

// Stocks
export interface StockQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  sparkline?: number[]; // Last 7 data points for mini chart
}

export interface StocksData {
  quotes: StockQuote[];
  updatedAt: string;
}

// Session Stats (local)
export interface StatsData {
  sessionStart: string;
  messagesCount: number;
  tokensEstimate: number;
  toolCalls: number;
  imagesGenerated: number;
}

// Todo
export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
}

export interface TodoData {
  items: TodoItem[];
}

// Combined widget data
export interface WidgetData {
  weather?: WeatherData;
  news?: NewsData;
  sports?: SportsData;
  stocks?: StocksData;
  stats?: StatsData;
  todo?: TodoData;
}

// Widget state
export interface WidgetState {
  data: WidgetData;
  loading: Record<string, boolean>;
  errors: Record<string, string | null>;
  lastFetch: Record<string, number>;
}
