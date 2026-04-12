"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

// =============================================================================
// ThinkingIndicator - Shows while agent is reasoning
// =============================================================================

export interface ThinkingIndicatorProps {
  message?: string;
  isActive?: boolean;
}

export function ThinkingIndicator({ message = "Thinking...", isActive = true }: ThinkingIndicatorProps) {
  if (!isActive) return null;

  return (
    <div className="rd-thinking">
      <span className="rd-dot rd-dot--active animate-thinking-pulse" />
      <span className="rd-thinking-text">{message}</span>
    </div>
  );
}

// =============================================================================
// ReasoningBubble - Shows chain-of-thought content
// =============================================================================

export interface ReasoningBubbleProps {
  content: string;
  isStreaming?: boolean;
  defaultCollapsed?: boolean;
  timestamp?: string;
}

export function ReasoningBubble({
  content,
  isStreaming = false,
  defaultCollapsed = false,
  timestamp,
}: ReasoningBubbleProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  if (!content && !isStreaming) return null;

  return (
    <div className="rd-container rd-container--bubble">
      {/* Header */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="rd-header"
      >
        <span
          className={`rd-dot ${isStreaming ? "rd-dot--active animate-thinking-pulse" : ""}`}
        />
        <span className="rd-header-title">
          {isStreaming ? "Thinking..." : "Thought Process"}
        </span>
        {timestamp && (
          <span className="rd-header-time">{timestamp}</span>
        )}
        <ChevronDown
          width={12}
          height={12}
          className={`rd-chevron ${isCollapsed ? "" : "rd-chevron--open"} ${timestamp ? "" : "rd-chevron--auto-ml"}`}
        />
      </button>

      {/* Content */}
      {!isCollapsed && (
        <div className="animate-expand rd-bubble-content">
          {content || "Processing..."}
          {isStreaming && <span className="rd-cursor" />}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// ReasoningTrace - Full trace with multiple steps
// =============================================================================

export interface ReasoningStep {
  id: string;
  content: string;
  timestamp?: string;
}

export interface ReasoningTraceProps {
  steps: ReasoningStep[];
  isActive?: boolean;
  currentContent?: string;
}

export function ReasoningTrace({ steps, isActive = false, currentContent }: ReasoningTraceProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  if (steps.length === 0 && !isActive) return null;

  return (
    <div className="rd-container rd-container--trace">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="rd-header"
      >
        <span
          className={`rd-dot ${isActive ? "rd-dot--active animate-thinking-pulse" : ""}`}
        />
        <span className="rd-header-title rd-header-title--bold">
          Reasoning Trace
        </span>
        <span className="rd-trace-count">
          {steps.length} step{steps.length !== 1 ? "s" : ""}
        </span>
        {isActive && (
          <span className="rd-trace-active">Active</span>
        )}
        <ChevronDown
          width={14}
          height={14}
          className={`rd-chevron ${isExpanded ? "rd-chevron--open" : ""} ${isActive ? "" : "rd-chevron--auto-ml"}`}
        />
      </button>

      {/* Steps */}
      {isExpanded && (
        <div className="animate-expand rd-trace-steps">
          {steps.map((step, idx) => (
            <div
              key={step.id}
              className={`rd-trace-step ${idx < steps.length - 1 || isActive ? "rd-trace-step--gap" : ""}`}
            >
              <div className="rd-trace-step-dot" />
              <div className="rd-trace-step-text">{step.content}</div>
              {step.timestamp && (
                <div className="rd-trace-step-time">{step.timestamp}</div>
              )}
            </div>
          ))}

          {/* Current streaming step */}
          {isActive && currentContent && (
            <div className="rd-trace-step">
              <div className="rd-trace-step-dot animate-thinking-pulse" />
              <div className="rd-trace-step-text">
                {currentContent}
                <span className="rd-cursor rd-cursor--sm" />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
