"use client";

import { useState, ReactNode } from "react";

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
          <ChevronIcon expanded={expanded} />
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
                      <RefreshIcon />
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

// SVG Icons
function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`widget-chevron ${expanded ? "expanded" : ""}`}
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 16h5v5" />
    </svg>
  );
}

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
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
        <path d="M16 14v6" />
        <path d="M8 14v6" />
        <path d="M12 16v6" />
      </svg>
    );
  }
  
  if (c.includes("cloud") || c.includes("overcast")) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
      </svg>
    );
  }
  
  if (c.includes("snow")) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
        <path d="M8 15h.01" />
        <path d="M8 19h.01" />
        <path d="M12 17h.01" />
        <path d="M12 21h.01" />
        <path d="M16 15h.01" />
        <path d="M16 19h.01" />
      </svg>
    );
  }
  
  // Default: sun
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );
}

export function NewsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" />
      <path d="M18 14h-8" />
      <path d="M15 18h-5" />
      <path d="M10 6h8v4h-8V6Z" />
    </svg>
  );
}

export function SportsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  );
}

export function StatsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" />
      <path d="m19 9-5 5-4-4-3 3" />
    </svg>
  );
}

export function TodoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
      <line x1="16" x2="16" y1="2" y2="6" />
      <line x1="8" x2="8" y1="2" y2="6" />
      <line x1="3" x2="21" y1="10" y2="10" />
      <path d="m9 16 2 2 4-4" />
    </svg>
  );
}

export function StocksIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}
