"use client";

import { useState, ReactNode } from "react";
import {
  ChevronRight,
  RefreshCw,
  CloudRain,
  Cloud,
  CloudSnow,
  Sun,
  Newspaper,
  Trophy,
  TrendingUp,
  CalendarCheck,
  Activity,
} from "lucide-react";

interface WidgetContainerProps {
  title: string;
  icon: ReactNode;
  badge?: string | number;
  isLoading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
  defaultExpanded?: boolean;
  lastUpdated?: string;
  children: ReactNode;
}

export function WidgetContainer({
  title,
  icon,
  badge,
  isLoading,
  error,
  onRefresh,
  defaultExpanded = false,
  lastUpdated,
  children,
}: WidgetContainerProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const formatTime = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ago`;
  };

  return (
    <div className={`widget ${expanded ? "widget-expanded" : "widget-collapsed"}`}>
      <button
        className="widget-header"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <div className="widget-header-left">
          <span className="widget-icon">{icon}</span>
          <span className="widget-title">{title}</span>
        </div>
        <div className="widget-header-right">
          {isLoading && <LoadingSpinner />}
          {!isLoading && badge && <span className="widget-badge">{badge}</span>}
          <ChevronRight
            className={`widget-chevron ${expanded ? "expanded" : ""}`}
            width={12}
            height={12}
          />
        </div>
      </button>

      {expanded && (
        <div className="widget-body">
          {error ? (
            <div className="widget-error">
              <span>{error}</span>
              {onRefresh && (
                <button onClick={onRefresh} className="widget-retry">
                  Retry
                </button>
              )}
            </div>
          ) : (
            <>
              {children}
              {lastUpdated && (
                <div className="widget-footer">
                  <span className="widget-updated">{formatTime(lastUpdated)}</span>
                  {onRefresh && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onRefresh();
                      }}
                      className="widget-refresh"
                      title="Refresh"
                      disabled={isLoading}
                    >
                      <RefreshCw width={12} height={12} />
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// LoadingSpinner uses a custom animated SVG (CSS animation via widget-spinner class)
function LoadingSpinner() {
  return (
    <svg className="widget-spinner" width="14" height="14" viewBox="0 0 24 24">
      <circle
        cx="12"
        cy="12"
        r="10"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray="32"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Reusable Widget Icons
export function WeatherIcon({ condition }: { condition?: string }) {
  const c = condition?.toLowerCase() || "sun";

  if (c.includes("rain") || c.includes("drizzle")) {
    return <CloudRain width={16} height={16} />;
  }

  if (c.includes("cloud") || c.includes("overcast")) {
    return <Cloud width={16} height={16} />;
  }

  if (c.includes("snow")) {
    return <CloudSnow width={16} height={16} />;
  }

  // Default: sun
  return <Sun width={16} height={16} />;
}

export function NewsIcon() {
  return <Newspaper width={16} height={16} />;
}

export function SportsIcon() {
  return <Trophy width={16} height={16} />;
}

export function StatsIcon() {
  return <TrendingUp width={16} height={16} />;
}

export function TodoIcon() {
  return <CalendarCheck width={16} height={16} />;
}

export function StocksIcon() {
  return <Activity width={16} height={16} />;
}
