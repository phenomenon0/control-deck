import { NextResponse } from "next/server";
import type { StocksData, StockQuote } from "@/lib/widgets/types";

// Cache stocks for 5 minutes
let cache: { data: StocksData; timestamp: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000;

// Default watchlist
const WATCHLIST = ["NVDA", "AAPL", "GOOGL", "MSFT", "AMD"];

// Fallback data when markets closed or API unavailable  
const FALLBACK_DATA: StockQuote[] = [
  { symbol: "NVDA", name: "NVIDIA", price: 142.50, change: 3.25, changePercent: 2.33, sparkline: [138, 139, 141, 140, 142, 141, 142] },
  { symbol: "AAPL", name: "Apple", price: 195.20, change: -1.10, changePercent: -0.56, sparkline: [196, 197, 196, 195, 194, 195, 195] },
  { symbol: "GOOGL", name: "Alphabet", price: 178.45, change: 2.15, changePercent: 1.22, sparkline: [175, 176, 177, 178, 177, 178, 178] },
  { symbol: "MSFT", name: "Microsoft", price: 448.30, change: 5.80, changePercent: 1.31, sparkline: [442, 444, 445, 446, 447, 448, 448] },
  { symbol: "AMD", name: "AMD", price: 125.80, change: -0.45, changePercent: -0.36, sparkline: [126, 127, 126, 125, 126, 126, 126] },
];

async function fetchYahooQuote(symbol: string): Promise<StockQuote | null> {
  try {
    // Using Yahoo Finance v8 API (unofficial but commonly used)
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d`,
      {
        headers: { 
          "User-Agent": "Control-Deck/1.0",
        },
        next: { revalidate: 300 },
      }
    );
    
    if (!res.ok) return null;
    
    const data = await res.json();
    const result = data.chart?.result?.[0];
    if (!result) return null;
    
    const meta = result.meta;
    const closes = result.indicators?.quote?.[0]?.close || [];
    
    // Get last 7 valid close prices for sparkline
    const validCloses = closes.filter((c: number | null) => c !== null).slice(-7);
    
    const price = meta.regularMarketPrice || 0;
    const prevClose = meta.previousClose || price;
    const change = price - prevClose;
    const changePercent = prevClose ? (change / prevClose) * 100 : 0;
    
    return {
      symbol: meta.symbol,
      name: meta.shortName || meta.symbol,
      price: Math.round(price * 100) / 100,
      change: Math.round(change * 100) / 100,
      changePercent: Math.round(changePercent * 100) / 100,
      sparkline: validCloses.map((c: number) => Math.round(c * 100) / 100),
    };
  } catch (error) {
    console.error(`[Stocks Widget] Failed to fetch ${symbol}:`, error);
    return null;
  }
}

export async function GET() {
  // Check cache
  if (cache && Date.now() - cache.timestamp < CACHE_TTL) {
    return NextResponse.json(cache.data);
  }

  try {
    // Fetch all quotes in parallel
    const results = await Promise.all(
      WATCHLIST.map((symbol) => fetchYahooQuote(symbol))
    );
    
    // Filter out failed fetches
    const quotes = results.filter((q): q is StockQuote => q !== null);
    
    // Use fallback if we got nothing
    const finalQuotes = quotes.length > 0 ? quotes : FALLBACK_DATA;
    
    const stocks: StocksData = {
      quotes: finalQuotes,
      updatedAt: new Date().toISOString(),
    };

    cache = { data: stocks, timestamp: Date.now() };
    return NextResponse.json(stocks);
  } catch (error) {
    console.error("[Stocks Widget] Error:", error);
    
    if (cache) {
      return NextResponse.json(cache.data);
    }
    
    return NextResponse.json({
      quotes: FALLBACK_DATA,
      updatedAt: new Date().toISOString(),
    });
  }
}
