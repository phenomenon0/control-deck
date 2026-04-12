"use client";

import { useState, useEffect, useCallback } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export interface TickerData {
  items: Array<{
    text: string;
    link?: string;
    icon?: string;
  }>;
  cycle: boolean;
  cycleInterval: number;
}

interface TickerTemplateProps {
  data: TickerData;
  onItemClick?: (item: TickerData["items"][0]) => void;
}

/**
 * TickerTemplate - Rotating single-line items (scores, headlines, alerts)
 * 
 * Displays one item at a time with smooth fade transitions.
 * Supports auto-cycling and manual navigation.
 */
export function TickerTemplate({ data, onItemClick }: TickerTemplateProps) {
  const { items, cycle, cycleInterval } = data;
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  const itemCount = items.length;

  const goToNext = useCallback(() => {
    if (itemCount <= 1) return;
    setIsAnimating(true);
    setTimeout(() => {
      setCurrentIndex((prev) => (prev + 1) % itemCount);
      setIsAnimating(false);
    }, 150);
  }, [itemCount]);

  const goToPrev = useCallback(() => {
    if (itemCount <= 1) return;
    setIsAnimating(true);
    setTimeout(() => {
      setCurrentIndex((prev) => (prev - 1 + itemCount) % itemCount);
      setIsAnimating(false);
    }, 150);
  }, [itemCount]);

  // Auto-cycle effect
  useEffect(() => {
    if (!cycle || isPaused || itemCount <= 1) return;

    const interval = setInterval(goToNext, cycleInterval);
    return () => clearInterval(interval);
  }, [cycle, isPaused, cycleInterval, itemCount, goToNext]);

  if (itemCount === 0) {
    return (
      <div className="ticker-empty">
        <span className="ticker-empty-text">No items to display</span>
      </div>
    );
  }

  const currentItem = items[currentIndex];

  const handleClick = () => {
    if (currentItem.link) {
      window.open(currentItem.link, "_blank", "noopener,noreferrer");
    }
    onItemClick?.(currentItem);
  };

  return (
    <div 
      className="ticker-container"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      {/* Navigation arrow - left */}
      {itemCount > 1 && (
        <button
          className="ticker-nav ticker-nav-prev"
          onClick={(e) => { e.stopPropagation(); goToPrev(); }}
          aria-label="Previous item"
        >
          <ChevronLeftIcon />
        </button>
      )}

      {/* Main ticker content */}
      <div 
        className={`ticker-content ${isAnimating ? "ticker-animating" : ""} ${currentItem.link ? "ticker-clickable" : ""}`}
        onClick={handleClick}
        role={currentItem.link ? "link" : undefined}
      >
        {currentItem.icon && (
          <span className="ticker-icon">{currentItem.icon}</span>
        )}
        <span className="ticker-text">{currentItem.text}</span>
      </div>

      {/* Navigation arrow - right */}
      {itemCount > 1 && (
        <button
          className="ticker-nav ticker-nav-next"
          onClick={(e) => { e.stopPropagation(); goToNext(); }}
          aria-label="Next item"
        >
          <ChevronRightIcon />
        </button>
      )}

      {/* Progress dots */}
      {itemCount > 1 && (
        <div className="ticker-dots">
          {items.map((_, idx) => (
            <button
              key={idx}
              className={`ticker-dot ${idx === currentIndex ? "ticker-dot-active" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                setCurrentIndex(idx);
              }}
              aria-label={`Go to item ${idx + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Icons
function ChevronLeftIcon() {
  return <ChevronLeft width={12} height={12} />;
}

function ChevronRightIcon() {
  return <ChevronRight width={12} height={12} />;
}
