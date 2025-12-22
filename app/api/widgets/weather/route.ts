import { NextResponse } from "next/server";
import type { WeatherData } from "@/lib/widgets/types";

// Cache weather for 10 minutes
let cache: { data: WeatherData; timestamp: number } | null = null;
const CACHE_TTL = 10 * 60 * 1000;

function mapConditionToIcon(condition: string): WeatherData["icon"] {
  const c = condition.toLowerCase();
  if (c.includes("rain") || c.includes("drizzle") || c.includes("shower")) return "rain";
  if (c.includes("snow") || c.includes("sleet") || c.includes("ice")) return "snow";
  if (c.includes("thunder") || c.includes("storm")) return "storm";
  if (c.includes("fog") || c.includes("mist") || c.includes("haze")) return "fog";
  if (c.includes("cloud") || c.includes("overcast")) return "cloud";
  if (c.includes("partly") || c.includes("partial")) return "partly-cloudy";
  return "sun";
}

export async function GET() {
  // Check cache
  if (cache && Date.now() - cache.timestamp < CACHE_TTL) {
    return NextResponse.json(cache.data);
  }

  try {
    // wttr.in provides free weather data, no API key needed
    // Using JSON format for structured data
    const res = await fetch("https://wttr.in/?format=j1", {
      headers: { "User-Agent": "Control-Deck/1.0" },
      next: { revalidate: 600 }, // 10 min
    });

    if (!res.ok) {
      throw new Error(`Weather API returned ${res.status}`);
    }

    const json = await res.json();
    const current = json.current_condition?.[0];
    const location = json.nearest_area?.[0];
    
    if (!current) {
      throw new Error("No weather data available");
    }

    const weather: WeatherData = {
      temp: parseInt(current.temp_F) || 0,
      feelsLike: parseInt(current.FeelsLikeF) || 0,
      condition: current.weatherDesc?.[0]?.value || "Unknown",
      icon: mapConditionToIcon(current.weatherDesc?.[0]?.value || ""),
      humidity: parseInt(current.humidity) || 0,
      wind: parseInt(current.windspeedMiles) || 0,
      location: location?.areaName?.[0]?.value || "Unknown",
      forecast: (json.weather || []).slice(0, 3).map((day: Record<string, unknown>) => ({
        day: new Date(day.date as string).toLocaleDateString("en-US", { weekday: "short" }),
        high: parseInt((day.maxtempF as string) || "0"),
        low: parseInt((day.mintempF as string) || "0"),
        condition: (day.hourly as Array<{ weatherDesc: Array<{ value: string }> }>)?.[4]?.weatherDesc?.[0]?.value || "Unknown",
        icon: mapConditionToIcon((day.hourly as Array<{ weatherDesc: Array<{ value: string }> }>)?.[4]?.weatherDesc?.[0]?.value || ""),
      })),
      updatedAt: new Date().toISOString(),
    };

    cache = { data: weather, timestamp: Date.now() };
    return NextResponse.json(weather);
  } catch (error) {
    console.error("[Weather Widget] Error:", error);
    
    // Return cached data if available, even if stale
    if (cache) {
      return NextResponse.json(cache.data);
    }
    
    return NextResponse.json(
      { error: "Failed to fetch weather" },
      { status: 500 }
    );
  }
}
