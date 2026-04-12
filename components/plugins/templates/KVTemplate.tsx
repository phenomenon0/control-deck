"use client";

import { List } from "lucide-react";

export interface KVPair {
  key: string;
  label: string;
  value: unknown;
  color?: string;
  icon?: string;
}

export interface KVData {
  pairs: KVPair[];
}

interface KVTemplateProps {
  data: KVData;
  layout?: "vertical" | "horizontal" | "grid";
  showIcons?: boolean;
}

/**
 * KVTemplate - Key-value pairs display (stats, status, config)
 * 
 * Displays labeled values in vertical, horizontal, or grid layouts.
 * Supports colors for status indicators.
 */
export function KVTemplate({ 
  data, 
  layout = "vertical",
  showIcons = true,
}: KVTemplateProps) {
  const { pairs } = data;

  if (pairs.length === 0) {
    return (
      <div className="kv-empty">
        <EmptyKVIcon />
        <span>No data to display</span>
      </div>
    );
  }

  // Format value for display
  const formatValue = (value: unknown): string => {
    if (value == null) return "-";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (typeof value === "number") {
      // Format large numbers with separators
      if (Math.abs(value) >= 1000) {
        return value.toLocaleString();
      }
      // Format decimals
      if (!Number.isInteger(value)) {
        return value.toFixed(2);
      }
      return String(value);
    }
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  };

  // Get color class or style
  const getColorStyle = (color?: string) => {
    if (!color) return {};
    
    const namedColors: Record<string, string> = {
      green: "var(--color-success)",
      red: "var(--color-error)",
      yellow: "var(--color-warning)",
      blue: "var(--color-info)",
      purple: "var(--color-accent)",
      orange: "var(--color-warning)",
      gray: "var(--color-muted)",
    };
    
    const resolvedColor = namedColors[color.toLowerCase()] || color;
    return { "--kv-color": resolvedColor } as React.CSSProperties;
  };

  return (
    <div className={`kv-container kv-${layout}`}>
      {pairs.map((pair, index) => (
        <div 
          key={pair.key || index}
          className={`kv-item ${pair.color ? "kv-colored" : ""}`}
          style={getColorStyle(pair.color)}
        >
          {/* Icon */}
          {showIcons && pair.icon && (
            <span className="kv-icon">{pair.icon}</span>
          )}
          
          {/* Label */}
          <span className="kv-label">{pair.label}</span>
          
          {/* Value */}
          <span className="kv-value">{formatValue(pair.value)}</span>
          
          {/* Color indicator */}
          {pair.color && <div className="kv-indicator" />}
        </div>
      ))}
    </div>
  );
}

// Icons
function EmptyKVIcon() {
  return <List width={24} height={24} strokeWidth={1.5} opacity={0.5} />;
}
