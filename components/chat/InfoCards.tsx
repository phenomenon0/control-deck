"use client";

import { useState, useMemo, useCallback, type ReactElement } from "react";

// =============================================================================
// Types
// =============================================================================

export interface TeamInfo {
  name: string;
  shortName?: string;
  icon?: string; // URL or emoji fallback
  score?: number;
}

export interface SportsScoreData {
  homeTeam: TeamInfo;
  awayTeam: TeamInfo;
  status: "scheduled" | "live" | "finished" | "postponed";
  competition?: string;
  venue?: string;
  date?: string;
  time?: string;
  minute?: number; // For live matches
  scorers?: { player: string; minute: number; team: "home" | "away" }[];
}

export interface WeatherData {
  location: string;
  temperature: number;
  feelsLike?: number;
  condition: string;
  conditionCode?: string; // For icon mapping
  humidity?: number;
  windSpeed?: number;
  windDirection?: string;
  high?: number;
  low?: number;
  forecast?: {
    day: string;
    high: number;
    low: number;
    condition: string;
  }[];
  updatedAt?: string;
}

// =============================================================================
// Team Icon Cache & Fetcher
// =============================================================================

const TEAM_ICONS: Record<string, string> = {
  // Premier League - include common variations
  "arsenal": "https://resources.premierleague.com/premierleague/badges/50/t3.png",
  "aston villa": "https://resources.premierleague.com/premierleague/badges/50/t7.png",
  "bournemouth": "https://resources.premierleague.com/premierleague/badges/50/t91.png",
  "brentford": "https://resources.premierleague.com/premierleague/badges/50/t94.png",
  "brighton": "https://resources.premierleague.com/premierleague/badges/50/t36.png",
  "chelsea": "https://resources.premierleague.com/premierleague/badges/50/t8.png",
  "crystal palace": "https://resources.premierleague.com/premierleague/badges/50/t31.png",
  "everton": "https://resources.premierleague.com/premierleague/badges/50/t11.png",
  "fulham": "https://resources.premierleague.com/premierleague/badges/50/t54.png",
  "ipswich": "https://resources.premierleague.com/premierleague/badges/50/t40.png",
  "ipswich town": "https://resources.premierleague.com/premierleague/badges/50/t40.png",
  "leicester": "https://resources.premierleague.com/premierleague/badges/50/t13.png",
  "leicester city": "https://resources.premierleague.com/premierleague/badges/50/t13.png",
  "liverpool": "https://resources.premierleague.com/premierleague/badges/50/t14.png",
  "manchester city": "https://resources.premierleague.com/premierleague/badges/50/t43.png",
  "man city": "https://resources.premierleague.com/premierleague/badges/50/t43.png",
  "manchester united": "https://resources.premierleague.com/premierleague/badges/50/t1.png",
  "man united": "https://resources.premierleague.com/premierleague/badges/50/t1.png",
  "man utd": "https://resources.premierleague.com/premierleague/badges/50/t1.png",
  "newcastle": "https://resources.premierleague.com/premierleague/badges/50/t4.png",
  "newcastle united": "https://resources.premierleague.com/premierleague/badges/50/t4.png",
  "nottingham forest": "https://resources.premierleague.com/premierleague/badges/50/t17.png",
  "nottm forest": "https://resources.premierleague.com/premierleague/badges/50/t17.png",
  "forest": "https://resources.premierleague.com/premierleague/badges/50/t17.png",
  "southampton": "https://resources.premierleague.com/premierleague/badges/50/t20.png",
  "tottenham": "https://resources.premierleague.com/premierleague/badges/50/t6.png",
  "tottenham hotspur": "https://resources.premierleague.com/premierleague/badges/50/t6.png",
  "spurs": "https://resources.premierleague.com/premierleague/badges/50/t6.png",
  "west ham": "https://resources.premierleague.com/premierleague/badges/50/t21.png",
  "west ham united": "https://resources.premierleague.com/premierleague/badges/50/t21.png",
  "wolves": "https://resources.premierleague.com/premierleague/badges/50/t39.png",
  "wolverhampton": "https://resources.premierleague.com/premierleague/badges/50/t39.png",
  "wolverhampton wanderers": "https://resources.premierleague.com/premierleague/badges/50/t39.png",
};

// Simple fallback initials generator
function getTeamInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "???";
  const words = trimmed.split(" ").filter(w => w.length > 0);
  if (words.length === 0) return "???";
  if (words.length === 1) return trimmed.slice(0, 3).toUpperCase();
  return words.map(w => w[0]).join("").toUpperCase().slice(0, 3);
}

function getTeamIcon(teamName: string): string | null {
  const normalized = teamName.toLowerCase().trim();
  
  // Direct match
  if (TEAM_ICONS[normalized]) {
    return TEAM_ICONS[normalized];
  }
  
  // Partial match - check if any key is contained in the name or vice versa
  for (const [key, url] of Object.entries(TEAM_ICONS)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return url;
    }
  }
  
  return null;
}

// Capitalize team name for display
function formatTeamName(name: string): string {
  return name
    .split(" ")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

// =============================================================================
// Validation Helpers
// =============================================================================

function isValidNumber(n: unknown): n is number {
  return typeof n === "number" && !Number.isNaN(n) && Number.isFinite(n);
}

// =============================================================================
// Weather Condition Icons
// =============================================================================

function getWeatherIcon(condition: string): string {
  const c = condition.toLowerCase();
  if (c.includes("sun") || c.includes("clear")) return "☀️";
  if (c.includes("cloud") && c.includes("part")) return "⛅";
  if (c.includes("cloud") || c.includes("overcast")) return "☁️";
  if (c.includes("rain") && c.includes("light")) return "🌦️";
  if (c.includes("rain") || c.includes("shower")) return "🌧️";
  if (c.includes("thunder") || c.includes("storm")) return "⛈️";
  if (c.includes("snow")) return "🌨️";
  if (c.includes("fog") || c.includes("mist")) return "🌫️";
  if (c.includes("wind")) return "💨";
  return "🌤️";
}

// =============================================================================
// SportsScoreCard
// =============================================================================

export interface SportsScoreCardProps {
  data: SportsScoreData;
}

export function SportsScoreCard({ data }: SportsScoreCardProps): ReactElement {
  const { homeTeam, awayTeam, status, competition, venue, date, time, minute, scorers } = data;
  
  // Format names for display
  const homeName = formatTeamName(homeTeam.shortName || homeTeam.name);
  const awayName = formatTeamName(awayTeam.shortName || awayTeam.name);
  
  // Memoize scorer filtering to avoid double iteration
  const { homeScorers, awayScorers } = useMemo(() => ({
    homeScorers: scorers?.filter(s => s.team === "home") ?? [],
    awayScorers: scorers?.filter(s => s.team === "away") ?? [],
  }), [scorers]);
  
  return (
    <div
      style={{
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: "var(--bg-secondary)",
        overflow: "hidden",
        marginBottom: 8,
        maxWidth: 380,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          borderBottom: "1px solid var(--separator)",
          background: "var(--bg-tertiary)",
        }}
      >
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {competition || "Football"}
        </span>
        <StatusBadge status={status} minute={minute} />
      </div>

      {/* Score Display - Single row: [Badge Name] Score - Score [Name Badge] */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "16px 12px",
          gap: 12,
        }}
      >
        {/* Home Team - Badge + Name together */}
        <TeamDisplay name={homeName} teamKey={homeTeam.name} />

        {/* Score in center */}
        <div 
          style={{ 
            display: "flex", 
            alignItems: "center", 
            gap: 8,
            padding: "8px 16px",
            background: "var(--bg-tertiary)",
            borderRadius: 8,
          }}
        >
          <span
            style={{
              fontSize: 24,
              fontWeight: 600,
              color: "var(--text-primary)",
              fontFamily: "ui-monospace, monospace",
              minWidth: 24,
              textAlign: "center",
            }}
          >
            {isValidNumber(homeTeam.score) ? homeTeam.score : "-"}
          </span>
          <span style={{ fontSize: 14, color: "var(--text-muted)" }}>-</span>
          <span
            style={{
              fontSize: 24,
              fontWeight: 600,
              color: "var(--text-primary)",
              fontFamily: "ui-monospace, monospace",
              minWidth: 24,
              textAlign: "center",
            }}
          >
            {isValidNumber(awayTeam.score) ? awayTeam.score : "-"}
          </span>
        </div>

        {/* Away Team - Name + Badge together */}
        <TeamDisplay name={awayName} teamKey={awayTeam.name} reverse />
      </div>

      {/* Scorers */}
      {(homeScorers.length > 0 || awayScorers.length > 0) && (
        <div
          style={{
            padding: "8px 12px",
            borderTop: "1px solid var(--separator)",
            background: "var(--bg-tertiary)",
          }}
        >
          <div style={{ display: "flex", gap: 16, fontSize: 10, color: "var(--text-muted)" }}>
            <div style={{ flex: 1 }}>
              {homeScorers.map((s) => (
                <div key={`${s.player}-${s.minute}-home`}>{s.player} {s.minute}&apos;</div>
              ))}
            </div>
            <div style={{ flex: 1, textAlign: "right" }}>
              {awayScorers.map((s) => (
                <div key={`${s.player}-${s.minute}-away`}>{s.player} {s.minute}&apos;</div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      {(venue || date || time) && (
        <div
          style={{
            padding: "6px 12px",
            borderTop: "1px solid var(--separator)",
            display: "flex",
            justifyContent: "space-between",
            fontSize: 10,
            color: "var(--text-muted)",
          }}
        >
          {venue && <span>{venue}</span>}
          {(date || time) && <span>{date} {time}</span>}
        </div>
      )}
    </div>
  );
}

// Team display component - keeps badge and name together
function TeamDisplay({ name, teamKey, reverse = false }: { name: string; teamKey: string; reverse?: boolean }): ReactElement {
  const [imgError, setImgError] = useState(false);
  const icon = useMemo(() => getTeamIcon(teamKey), [teamKey]);
  const handleImgError = useCallback(() => setImgError(true), []);
  
  const badge = icon && !imgError ? (
    <img
      src={icon}
      alt={`${name} team badge`}
      onError={handleImgError}
      loading="lazy"
      style={{ width: 32, height: 32, objectFit: "contain" }}
    />
  ) : (
    <div
      style={{
        width: 32,
        height: 32,
        borderRadius: "50%",
        background: "var(--bg-tertiary)",
        border: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 10,
        fontWeight: 600,
        color: "var(--text-secondary)",
      }}
    >
      {getTeamInitials(name)}
    </div>
  );
  
  const nameEl = (
    <span 
      style={{ 
        fontSize: 12, 
        color: "var(--text-primary)", 
        fontWeight: 500,
        maxWidth: 80,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {name}
    </span>
  );
  
  return (
    <div 
      style={{ 
        display: "flex", 
        alignItems: "center", 
        gap: 6,
        flexDirection: reverse ? "row-reverse" : "row",
      }}
    >
      {badge}
      {nameEl}
    </div>
  );
}

function StatusBadge({ status, minute }: { status: SportsScoreData["status"]; minute?: number }): ReactElement {
  const isLive = status === "live";
  
  const styles: Record<SportsScoreData["status"], { bg: string; color: string; text: string; ariaLabel: string }> = {
    live: { bg: "rgba(139, 166, 122, 0.15)", color: "var(--success)", text: minute ? `${minute}'` : "LIVE", ariaLabel: minute ? `Live, ${minute} minutes` : "Live" },
    finished: { bg: "var(--bg-tertiary)", color: "var(--text-muted)", text: "FT", ariaLabel: "Full time" },
    scheduled: { bg: "var(--bg-tertiary)", color: "var(--text-muted)", text: "Scheduled", ariaLabel: "Scheduled" },
    postponed: { bg: "rgba(196, 122, 122, 0.15)", color: "var(--error)", text: "Postponed", ariaLabel: "Postponed" },
  };
  
  const s = styles[status] || styles.scheduled;
  
  return (
    <span
      role="status"
      aria-label={s.ariaLabel}
      style={{
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 10,
        fontWeight: 500,
        background: s.bg,
        color: s.color,
        display: "flex",
        alignItems: "center",
        gap: 4,
      }}
    >
      {isLive && (
        <span
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "var(--success)",
            animation: "pulse 2s infinite",
          }}
        />
      )}
      {s.text}
    </span>
  );
}

// =============================================================================
// WeatherCard
// =============================================================================

export interface WeatherCardProps {
  data: WeatherData;
}

export function WeatherCard({ data }: WeatherCardProps): ReactElement {
  const { location, temperature, feelsLike, condition, humidity, windSpeed, windDirection, high, low, forecast, updatedAt } = data;
  
  const icon = getWeatherIcon(condition);
  
  return (
    <div
      style={{
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: "var(--bg-secondary)",
        overflow: "hidden",
        marginBottom: 8,
        maxWidth: 320,
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "10px 12px",
          borderBottom: "1px solid var(--separator)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 14 }} role="img" aria-label="Location">📍</span>
          <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>
            {location}
          </span>
        </div>
        {updatedAt && (
          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
            {updatedAt}
          </span>
        )}
      </div>

      {/* Current Weather */}
      <div
        style={{
          padding: "16px 12px",
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}
      >
        {/* Icon & Temp */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 40 }} role="img" aria-label={condition}>{icon}</span>
          <div>
            <div
              style={{
                fontSize: 32,
                fontWeight: 500,
                color: "var(--text-primary)",
                lineHeight: 1,
              }}
            >
              {isValidNumber(temperature) ? Math.round(temperature) : "--"}°
            </div>
            {isValidNumber(feelsLike) && (
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                Feels {Math.round(feelsLike)}°
              </div>
            )}
          </div>
        </div>

        {/* Condition & Details */}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 4 }}>
            {condition}
          </div>
          {(isValidNumber(high) || isValidNumber(low)) && (
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              H: {isValidNumber(high) ? high : "--"}° L: {isValidNumber(low) ? low : "--"}°
            </div>
          )}
        </div>
      </div>

      {/* Stats Row */}
      {(humidity !== undefined || windSpeed !== undefined) && (
        <div
          style={{
            display: "flex",
            gap: 16,
            padding: "8px 12px",
            borderTop: "1px solid var(--separator)",
            background: "var(--bg-tertiary)",
          }}
        >
          {humidity !== undefined && (
            <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--text-muted)" }}>
              <span>💧</span>
              <span>{humidity}%</span>
            </div>
          )}
          {windSpeed !== undefined && (
            <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--text-muted)" }}>
              <span>💨</span>
              <span>{windSpeed} km/h {windDirection || ""}</span>
            </div>
          )}
        </div>
      )}

      {/* Forecast */}
      {forecast && forecast.length > 0 && (() => {
        const displayForecast = forecast.slice(0, 5);
        return (
          <div
            style={{
              display: "flex",
              borderTop: "1px solid var(--separator)",
            }}
          >
            {displayForecast.map((day, idx) => (
              <div
                key={`${day.day}-${idx}`}
                style={{
                  flex: 1,
                  padding: "8px 4px",
                  textAlign: "center",
                  borderRight: idx < displayForecast.length - 1 ? "1px solid var(--separator)" : "none",
                }}
              >
                <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>
                  {day.day}
                </div>
                <div style={{ fontSize: 16, marginBottom: 2 }}>
                  {getWeatherIcon(day.condition)}
                </div>
                <div style={{ fontSize: 10, color: "var(--text-secondary)" }}>
                  {isValidNumber(day.high) ? day.high : "--"}° / {isValidNumber(day.low) ? day.low : "--"}°
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}

// =============================================================================
// Generic InfoCard (for arbitrary structured data)
// =============================================================================

export interface InfoCardProps {
  title: string;
  icon?: string;
  fields: { label: string; value: string | number }[];
  footer?: string;
}

export function InfoCard({ title, icon, fields, footer }: InfoCardProps): ReactElement {
  return (
    <div
      style={{
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: "var(--bg-secondary)",
        overflow: "hidden",
        marginBottom: 8,
        maxWidth: 300,
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid var(--separator)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "var(--bg-tertiary)",
        }}
      >
        {icon && <span style={{ fontSize: 14 }} role="img" aria-hidden="true">{icon}</span>}
        <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-primary)" }}>
          {title}
        </span>
      </div>

      {/* Fields */}
      <div style={{ padding: "8px 12px" }}>
        {fields.map((field) => (
          <div
            key={field.label}
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "4px 0",
            }}
          >
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{field.label}</span>
            <span style={{ fontSize: 11, color: "var(--text-primary)", fontFamily: "ui-monospace, monospace" }}>
              {field.value}
            </span>
          </div>
        ))}
      </div>

      {/* Footer */}
      {footer && (
        <div
          style={{
            padding: "6px 12px",
            borderTop: "1px solid var(--separator)",
            fontSize: 10,
            color: "var(--text-muted)",
            background: "var(--bg-tertiary)",
          }}
        >
          {footer}
        </div>
      )}
    </div>
  );
}
