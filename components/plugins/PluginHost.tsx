"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ChevronRight,
  RefreshCw,
  Settings,
  X,
  AlertCircle,
  Puzzle,
  Trophy,
  Newspaper,
  TrendingUp,
  Sun,
  Github,
  Rss,
  Search,
  List,
  LayoutGrid,
} from "lucide-react";
import type { PluginInstance, PluginData } from "@/lib/plugins/types";
import { mergeConfigValues } from "@/lib/plugins";
import {
  TickerTemplate,
  FeedTemplate,
  CardsTemplate,
  TableTemplate,
  KVTemplate,
  FormTemplate,
  type TickerData,
  type FeedData,
  type CardsData,
  type TableData,
  type KVData,
  type FormData,
} from "./templates";

interface PluginHostProps {
  plugin: PluginInstance;
  onSettingsClick?: () => void;
  onRemove?: () => void;
  compact?: boolean;
}

interface PluginState {
  data: PluginData | null;
  renderedData: unknown;
  loading: boolean;
  error: string | null;
  lastRefresh: number | null;
}

/**
 * PluginHost - Renders a plugin instance using its configured template
 * 
 * Handles:
 * - Data fetching and caching
 * - Template selection and rendering
 * - Loading/error states
 * - Refresh logic
 */
export function PluginHost({ 
  plugin, 
  onSettingsClick, 
  onRemove,
  compact = false,
}: PluginHostProps) {
  const [state, setState] = useState<PluginState>({
    data: null,
    renderedData: null,
    loading: true,
    error: null,
    lastRefresh: null,
  });
  const [expanded, setExpanded] = useState(!compact);

  // Merge config values
  const configValues = useMemo(() => {
    return mergeConfigValues(
      plugin.bundle.config.schema,
      plugin.bundle.config.defaults,
      plugin.configValues
    );
  }, [plugin.bundle.config, plugin.configValues]);

  // Fetch data via API (to avoid importing server-side code)
  const refresh = useCallback(async (force = false) => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      const res = await fetch("/api/plugins/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pluginId: plugin.id,
          bundle: plugin.bundle,
          configValues: plugin.configValues,
          forceRefresh: force,
        }),
      });
      
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to fetch data");
      }
      
      const { data, renderedData } = await res.json();
      
      // Check for errors in sources
      const sources = data.sources as PluginData["sources"];
      const sourceErrors = Object.entries(sources)
        .filter(([_, s]) => s.error)
        .map(([id, s]) => `${id}: ${s.error}`);
      
      if (sourceErrors.length > 0 && Object.values(sources).every(s => s.error)) {
        throw new Error(sourceErrors.join("; "));
      }
      
      setState({
        data,
        renderedData,
        loading: false,
        error: sourceErrors.length > 0 ? `Partial error: ${sourceErrors[0]}` : null,
        lastRefresh: Date.now(),
      });
    } catch (err) {
      setState(prev => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : "Failed to fetch data",
      }));
    }
  }, [plugin.id, plugin.bundle, plugin.configValues]);

  // Initial fetch
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-refresh when data expires
  useEffect(() => {
    if (!state.data || state.loading) return;
    
    const checkExpiry = () => {
      // Check if any source has expired
      const now = Date.now();
      const hasExpired = Object.values(state.data!.sources).some(
        (s) => new Date(s.expiresAt).getTime() < now
      );
      if (hasExpired) {
        refresh();
      }
    };
    
    // Check every 30 seconds
    const interval = setInterval(checkExpiry, 30000);
    return () => clearInterval(interval);
  }, [state.data, state.loading, refresh]);

  // Format last updated time
  const formatLastUpdated = () => {
    if (!state.lastRefresh) return null;
    const diff = Date.now() - state.lastRefresh;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ago`;
  };

  // Handle form submission (for form template) via API
  const handleFormSubmit = useCallback(async (values: Record<string, unknown>) => {
    const render = plugin.bundle.render as { submitTool?: string };
    if (!render.submitTool) {
      throw new Error("No submit tool configured");
    }
    
    // Call the tool execution API
    const res = await fetch("/api/plugins/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pluginId: `${plugin.id}_form_submit`,
        bundle: {
          ...plugin.bundle,
          sources: [{
            id: "form_result",
            tool: render.submitTool,
            args: values,
            refresh: "manual",
          }],
        },
        configValues: {},
        forceRefresh: true,
      }),
    });
    
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || "Tool execution failed");
    }
    
    const { data } = await res.json();
    const result = data.sources?.form_result;
    
    if (result?.error) {
      throw new Error(result.error);
    }
    
    return result?.data;
  }, [plugin.id, plugin.bundle]);

  // Render the appropriate template
  const renderTemplate = () => {
    if (state.loading && !state.renderedData) {
      return <PluginLoading />;
    }
    
    if (state.error && !state.renderedData) {
      return <PluginError message={state.error} onRetry={() => refresh(true)} />;
    }
    
    const data = state.renderedData;
    
    switch (plugin.template) {
      case "ticker":
        return <TickerTemplate data={data as TickerData} />;
      
      case "feed":
        return (
          <FeedTemplate 
            data={data as FeedData} 
            maxItems={(plugin.bundle.render as { maxItems?: number }).maxItems}
          />
        );
      
      case "cards":
        return (
          <CardsTemplate 
            data={data as CardsData}
            maxCards={(plugin.bundle.render as { maxCards?: number }).maxCards}
          />
        );
      
      case "table":
        return (
          <TableTemplate 
            data={data as TableData}
            maxRows={(plugin.bundle.render as { maxRows?: number }).maxRows}
            clickable={(plugin.bundle.render as { clickable?: boolean }).clickable}
          />
        );
      
      case "kv":
        return (
          <KVTemplate 
            data={data as KVData}
            layout={(plugin.bundle.render as { layout?: "vertical" | "horizontal" }).layout}
          />
        );
      
      case "form":
        return (
          <FormTemplate 
            data={{
              fields: (plugin.bundle.render as { fields: string[] }).fields,
              schema: plugin.bundle.config.schema,
              submitLabel: (plugin.bundle.render as { submitLabel?: string }).submitLabel,
              resultDisplay: (plugin.bundle.render as { resultDisplay?: "text" | "json" | "table" }).resultDisplay,
            }}
            onSubmit={handleFormSubmit}
            initialValues={configValues}
          />
        );
      
      default:
        return <PluginError message={`Unknown template: ${plugin.template}`} />;
    }
  };

  return (
    <div className={`plugin-host ${compact ? "plugin-compact" : ""} ${expanded ? "plugin-expanded" : "plugin-collapsed"}`}>
      {/* Header */}
      <div className="plugin-header" onClick={() => compact && setExpanded(!expanded)}>
        <div className="plugin-header-left">
          <span className="plugin-icon">{getPluginIcon(plugin.icon)}</span>
          <span className="plugin-name">{plugin.name}</span>
        </div>
        <div className="plugin-header-right">
          {state.loading && <Spinner />}
          {!state.loading && state.error && <ErrorBadge />}
          
          {/* Actions */}
          <div className="plugin-actions">
            <button
              className="plugin-action"
              onClick={(e) => { e.stopPropagation(); refresh(true); }}
              title="Refresh"
              disabled={state.loading}
            >
              <RefreshIcon />
            </button>
            {onSettingsClick && (
              <button
                className="plugin-action"
                onClick={(e) => { e.stopPropagation(); onSettingsClick(); }}
                title="Settings"
              >
                <SettingsIcon />
              </button>
            )}
            {onRemove && (
              <button
                className="plugin-action plugin-action-remove"
                onClick={(e) => { e.stopPropagation(); onRemove(); }}
                title="Remove"
              >
                <RemoveIcon />
              </button>
            )}
          </div>
          
          {compact && <ChevronIcon expanded={expanded} />}
        </div>
      </div>
      
      {/* Body */}
      {(!compact || expanded) && (
        <div className="plugin-body">
          {renderTemplate()}
          
          {/* Footer with last updated */}
          {state.lastRefresh && !state.loading && (
            <div className="plugin-footer">
              <span className="plugin-updated">{formatLastUpdated()}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Sub-components
// =============================================================================

function PluginLoading() {
  return (
    <div className="plugin-loading">
      <Spinner />
      <span>Loading...</span>
    </div>
  );
}

function PluginError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="plugin-error">
      <ErrorIcon />
      <span className="plugin-error-message">{message}</span>
      {onRetry && (
        <button className="plugin-retry" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

// =============================================================================
// Icons
// =============================================================================

function getPluginIcon(iconName: string): React.ReactNode {
  // Map icon names to SVG icons
  const icons: Record<string, React.ReactNode> = {
    puzzle: <PuzzleIcon />,
    trophy: <TrophyIcon />,
    news: <NewsIcon />,
    chart: <ChartIcon />,
    weather: <WeatherIcon />,
    github: <GithubIcon />,
    rss: <RssIcon />,
    search: <SearchIcon />,
    list: <ListIcon />,
    grid: <GridIcon />,
  };
  
  return icons[iconName] || icons.puzzle;
}

// Custom animated spinner (CSS animation via plugin-spinner class)
function Spinner() {
  return (
    <svg className="plugin-spinner" width="14" height="14" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="32" strokeLinecap="round" />
    </svg>
  );
}

function ErrorBadge() {
  return <span className="plugin-error-badge" title="Error fetching data">!</span>;
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return <ChevronRight className={`plugin-chevron ${expanded ? "expanded" : ""}`} width={12} height={12} />;
}

function RefreshIcon() {
  return <RefreshCw width={12} height={12} />;
}

function SettingsIcon() {
  return <Settings width={12} height={12} />;
}

function RemoveIcon() {
  return <X width={12} height={12} />;
}

function ErrorIcon() {
  return <AlertCircle width={16} height={16} />;
}

function PuzzleIcon() {
  return <Puzzle width={14} height={14} />;
}

function TrophyIcon() {
  return <Trophy width={14} height={14} />;
}

function NewsIcon() {
  return <Newspaper width={14} height={14} />;
}

function ChartIcon() {
  return <TrendingUp width={14} height={14} />;
}

function WeatherIcon() {
  return <Sun width={14} height={14} />;
}

function GithubIcon() {
  return <Github width={14} height={14} />;
}

function RssIcon() {
  return <Rss width={14} height={14} />;
}

function SearchIcon() {
  return <Search width={14} height={14} />;
}

function ListIcon() {
  return <List width={14} height={14} />;
}

function GridIcon() {
  return <LayoutGrid width={14} height={14} />;
}
