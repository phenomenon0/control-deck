"use client";

import { useState } from "react";
import { Newspaper, ExternalLink } from "lucide-react";

export interface FeedItem {
  id?: string;
  title: string;
  description?: string;
  link?: string;
  time?: string;
  image?: string;
  source?: string;
  read?: boolean;
}

export interface FeedData {
  items: FeedItem[];
}

interface FeedTemplateProps {
  data: FeedData;
  maxItems?: number;
  showImages?: boolean;
  onItemClick?: (item: FeedItem) => void;
}

/**
 * FeedTemplate - Scrollable list of items (news, alerts, activity)
 * 
 * Displays items in a vertical scrollable list with optional images,
 * timestamps, and read state tracking.
 */
export function FeedTemplate({ 
  data, 
  maxItems = 10, 
  showImages = true,
  onItemClick 
}: FeedTemplateProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  
  const items = data.items.slice(0, maxItems);

  if (items.length === 0) {
    return (
      <div className="feed-empty">
        <EmptyIcon />
        <span>No items to display</span>
      </div>
    );
  }

  const formatTime = (timeStr?: string) => {
    if (!timeStr) return null;
    try {
      const date = new Date(timeStr);
      const now = Date.now();
      const diff = now - date.getTime();
      const mins = Math.floor(diff / 60000);
      
      if (mins < 1) return "just now";
      if (mins < 60) return `${mins}m ago`;
      if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
      return `${Math.floor(mins / 1440)}d ago`;
    } catch {
      return timeStr;
    }
  };

  const handleItemClick = (item: FeedItem, index: number) => {
    const itemId = item.id || String(index);
    
    if (item.description) {
      setExpandedId(expandedId === itemId ? null : itemId);
    }
    
    if (item.link) {
      window.open(item.link, "_blank", "noopener,noreferrer");
    }
    
    onItemClick?.(item);
  };

  return (
    <div className="feed-container">
      <div className="feed-list">
        {items.map((item, index) => {
          const itemId = item.id || String(index);
          const isExpanded = expandedId === itemId;
          
          return (
            <div
              key={itemId}
              className={`feed-item ${item.read ? "feed-item-read" : ""} ${isExpanded ? "feed-item-expanded" : ""}`}
              onClick={() => handleItemClick(item, index)}
              role="article"
            >
              {/* Image */}
              {showImages && item.image && (
                <div className="feed-item-image">
                  <img 
                    src={item.image} 
                    alt="" 
                    loading="lazy"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                </div>
              )}
              
              {/* Content */}
              <div className="feed-item-content">
                <div className="feed-item-header">
                  <span className="feed-item-title">{item.title}</span>
                  {item.link && <LinkIcon />}
                </div>
                
                {/* Description (collapsible) */}
                {item.description && (
                  <p className={`feed-item-description ${isExpanded ? "expanded" : ""}`}>
                    {item.description}
                  </p>
                )}
                
                {/* Meta row */}
                <div className="feed-item-meta">
                  {item.source && (
                    <span className="feed-item-source">{item.source}</span>
                  )}
                  {item.time && (
                    <span className="feed-item-time">{formatTime(item.time)}</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      
      {/* Show more indicator */}
      {data.items.length > maxItems && (
        <div className="feed-more">
          +{data.items.length - maxItems} more items
        </div>
      )}
    </div>
  );
}

// Icons
function EmptyIcon() {
  return <Newspaper width={24} height={24} strokeWidth={1.5} opacity={0.5} />;
}

function LinkIcon() {
  return <ExternalLink width={10} height={10} className="feed-link-icon" />;
}
