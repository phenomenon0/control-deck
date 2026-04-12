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
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 14px",
        background: "var(--bg-secondary)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        marginBottom: 8,
        maxWidth: 200,
      }}
    >
      <span
        className="animate-thinking-pulse"
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: "var(--accent)",
          flexShrink: 0,
        }}
      />
      <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{message}</span>
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
    <div
      style={{
        borderRadius: 6,
        border: "1px solid var(--border)",
        background: "var(--bg-secondary)",
        overflow: "hidden",
        marginBottom: 8,
        maxWidth: 500,
      }}
    >
      {/* Header */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          font: "inherit",
          transition: "background 150ms cubic-bezier(0, 0, 0.2, 1)",
        }}
      >
        <span
          className={isStreaming ? "animate-thinking-pulse" : ""}
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: isStreaming ? "var(--accent)" : "var(--text-muted)",
            flexShrink: 0,
          }}
        />
        <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-secondary)" }}>
          {isStreaming ? "Thinking..." : "Thought Process"}
        </span>
        {timestamp && (
          <span style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: "auto" }}>
            {timestamp}
          </span>
        )}
        <ChevronDown
          width={12}
          height={12}
          style={{
            color: "var(--text-muted)",
            transform: isCollapsed ? "rotate(0deg)" : "rotate(180deg)",
            transition: "transform 150ms cubic-bezier(0, 0, 0.2, 1)",
            marginLeft: timestamp ? 0 : "auto",
          }}
        />
      </button>

      {/* Content */}
      {!isCollapsed && (
        <div
          className="animate-expand"
          style={{
            padding: "8px 12px 10px",
            borderTop: "1px solid var(--border)",
            fontSize: 13,
            color: "var(--text-secondary)",
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            paddingLeft: 28,
          }}
        >
          {content || "Processing..."}
          {isStreaming && (
            <span
              style={{
                display: "inline-block",
                width: 2,
                height: 14,
                background: "var(--accent)",
                marginLeft: 2,
                animation: "blink 1s infinite",
              }}
            />
          )}
        </div>
      )}

      <style>{`
        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
      `}</style>
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
    <div
      style={{
        borderRadius: 6,
        border: "1px solid var(--border)",
        background: "var(--bg-secondary)",
        overflow: "hidden",
        marginBottom: 12,
        maxWidth: 550,
      }}
    >
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          font: "inherit",
          transition: "background 150ms cubic-bezier(0, 0, 0.2, 1)",
        }}
      >
        <span
          className={isActive ? "animate-thinking-pulse" : ""}
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: isActive ? "var(--accent)" : "var(--text-muted)",
            flexShrink: 0,
          }}
        />
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>
          Reasoning Trace
        </span>
        <span
          style={{
            fontSize: 10,
            padding: "2px 6px",
            background: "var(--bg-tertiary)",
            borderRadius: 6,
            color: "var(--text-muted)",
          }}
        >
          {steps.length} step{steps.length !== 1 ? "s" : ""}
        </span>
        {isActive && (
          <span style={{ fontSize: 10, color: "var(--accent)", marginLeft: "auto" }}>
            Active
          </span>
        )}
        <ChevronDown
          width={14}
          height={14}
          style={{
            color: "var(--text-muted)",
            transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 150ms cubic-bezier(0, 0, 0.2, 1)",
            marginLeft: isActive ? 0 : "auto",
          }}
        />
      </button>

      {/* Steps */}
      {isExpanded && (
        <div className="animate-expand" style={{ padding: "8px 12px" }}>
          {steps.map((step, idx) => (
            <div
              key={step.id}
              style={{
                position: "relative",
                paddingLeft: 20,
                paddingBottom: idx < steps.length - 1 || isActive ? 12 : 0,
                borderLeft: "2px solid var(--border)",
                marginLeft: 6,
              }}
            >
              {/* Step dot */}
              <div
                style={{
                  position: "absolute",
                  left: -5,
                  top: 4,
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "var(--accent)",
                }}
              />
              {/* Step content */}
              <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                {step.content}
              </div>
              {step.timestamp && (
                <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
                  {step.timestamp}
                </div>
              )}
            </div>
          ))}

          {/* Current streaming step */}
          {isActive && currentContent && (
            <div
              style={{
                position: "relative",
                paddingLeft: 20,
                borderLeft: "2px solid var(--border)",
                marginLeft: 6,
              }}
            >
              <div
                className="animate-thinking-pulse"
                style={{
                  position: "absolute",
                  left: -5,
                  top: 4,
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "var(--accent)",
                }}
              />
              <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                {currentContent}
                <span
                  style={{
                    display: "inline-block",
                    width: 2,
                    height: 12,
                    background: "var(--accent)",
                    marginLeft: 2,
                    animation: "blink 1s infinite",
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
