"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

export interface ReasoningBubbleProps {
  content: string;
  isStreaming?: boolean;
  isCollapsed?: boolean;
  timestamp?: string;
}

export function ReasoningBubble({
  content,
  isStreaming = false,
  isCollapsed: initialCollapsed = false,
  timestamp,
}: ReasoningBubbleProps) {
  const [isCollapsed, setIsCollapsed] = useState(initialCollapsed);

  return (
    <div className="rounded-lg border border-pink-500/30 bg-pink-500/5 p-3 max-w-md animate-fade-in">
      {/* Header */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="flex items-center gap-2 w-full text-left"
      >
        <span className={`text-lg ${isStreaming ? "animate-brain" : ""}`}>
          🧠
        </span>
        <span className="text-xs font-medium text-pink-400">
          {isStreaming ? "Thinking..." : "Reasoning"}
        </span>
        {timestamp && (
          <span className="text-[10px] text-[var(--text-muted)] ml-auto">
            {timestamp}
          </span>
        )}
        <ChevronDown
          className={`w-3 h-3 text-pink-400 transition-transform ${
            isCollapsed ? "" : "rotate-180"
          }`}
        />
      </button>

      {/* Content */}
      {!isCollapsed && (
        <div className="mt-2 pt-2 border-t border-pink-500/20">
          <p className={`text-sm text-[var(--text-secondary)] leading-relaxed ${
            isStreaming ? "cursor-blink" : ""
          }`}>
            {content || (isStreaming ? "Processing..." : "No reasoning content")}
          </p>
        </div>
      )}
    </div>
  );
}

export interface ThinkingIndicatorProps {
  message?: string;
  duration?: number;
}

export function ThinkingIndicator({
  message = "Thinking...",
  duration,
}: ThinkingIndicatorProps) {
  return (
    <div className="flex items-center gap-2 text-sm text-[var(--text-muted)] animate-fade-in">
      <span className="animate-brain">🧠</span>
      <span>{message}</span>
      {duration !== undefined && (
        <span className="text-[10px] font-mono">
          {(duration / 1000).toFixed(1)}s
        </span>
      )}
      <div className="flex gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-pink-400 animate-pulse" style={{ animationDelay: "0ms" }} />
        <span className="w-1.5 h-1.5 rounded-full bg-pink-400 animate-pulse" style={{ animationDelay: "150ms" }} />
        <span className="w-1.5 h-1.5 rounded-full bg-pink-400 animate-pulse" style={{ animationDelay: "300ms" }} />
      </div>
    </div>
  );
}
