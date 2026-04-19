"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

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

export interface ReasoningBubbleProps {
  content: string;
  isStreaming?: boolean;
  defaultCollapsed?: boolean;
  timestamp?: string;
}

function tokenCount(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.round(text.length / 4));
}

export function ReasoningBubble({
  content,
  isStreaming = false,
  defaultCollapsed = false,
  timestamp,
}: ReasoningBubbleProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  if (!content && !isStreaming) return null;

  const paragraphs = content ? content.split(/\n{2,}/).filter(Boolean) : [];
  const tokens = tokenCount(content);

  return (
    <div className="reasoning">
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="reasoning-head"
        type="button"
      >
        <span className="reasoning-head-left">
          <span className="label">{isStreaming ? "Thinking" : "Reasoning"}</span>
          {isStreaming && <span className="reasoning-head-dot" aria-hidden="true" />}
        </span>
        <span className="reasoning-head-right">
          {timestamp && <span className="reasoning-head-time">{timestamp}</span>}
          {!isStreaming && tokens > 0 && (
            <span className="reasoning-head-tokens">{tokens} tok</span>
          )}
          <ChevronDown
            width={12}
            height={12}
            className={`reasoning-chevron ${isCollapsed ? "" : "reasoning-chevron--open"}`}
          />
        </span>
      </button>

      {!isCollapsed && (
        <div className="animate-expand reasoning-body">
          {paragraphs.length > 0 ? (
            paragraphs.map((p, i) => (
              <p key={i}>
                {p}
                {isStreaming && i === paragraphs.length - 1 && (
                  <span className="reasoning-cursor">▮</span>
                )}
              </p>
            ))
          ) : (
            <p>
              Processing<span className="reasoning-cursor">▮</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

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
