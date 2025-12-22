"use client";

import { useState } from "react";

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
        gap: 8,
        padding: "8px 12px",
        background: "rgba(236, 72, 153, 0.08)",
        border: "1px solid rgba(236, 72, 153, 0.2)",
        borderRadius: 8,
        marginBottom: 8,
        maxWidth: 300,
      }}
    >
      <span className="animate-brain" style={{ fontSize: 18 }}>🧠</span>
      <span style={{ fontSize: 13, color: "#f472b6" }}>{message}</span>
      <div style={{ display: "flex", gap: 3, marginLeft: "auto" }}>
        <span
          style={{
            width: 4,
            height: 4,
            borderRadius: "50%",
            background: "#f472b6",
            animation: "pulse-dot 1.2s ease-in-out infinite",
          }}
        />
        <span
          style={{
            width: 4,
            height: 4,
            borderRadius: "50%",
            background: "#f472b6",
            animation: "pulse-dot 1.2s ease-in-out 0.2s infinite",
          }}
        />
        <span
          style={{
            width: 4,
            height: 4,
            borderRadius: "50%",
            background: "#f472b6",
            animation: "pulse-dot 1.2s ease-in-out 0.4s infinite",
          }}
        />
      </div>
      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 0.3; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1); }
        }
      `}</style>
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
        borderRadius: 8,
        border: "1px solid rgba(236, 72, 153, 0.25)",
        background: "rgba(236, 72, 153, 0.05)",
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
          padding: "6px 10px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          font: "inherit",
        }}
      >
        <span className={isStreaming ? "animate-brain" : ""} style={{ fontSize: 14 }}>
          🧠
        </span>
        <span style={{ fontSize: 11, fontWeight: 500, color: "#f472b6" }}>
          {isStreaming ? "Reasoning..." : "Chain of Thought"}
        </span>
        {timestamp && (
          <span style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: "auto" }}>
            {timestamp}
          </span>
        )}
        <svg
          width={12}
          height={12}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          style={{
            color: "#f472b6",
            transform: isCollapsed ? "rotate(0deg)" : "rotate(180deg)",
            transition: "transform 0.15s",
            marginLeft: timestamp ? 0 : "auto",
          }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {/* Content */}
      {!isCollapsed && (
        <div
          style={{
            padding: "8px 10px",
            borderTop: "1px solid rgba(236, 72, 153, 0.15)",
            fontSize: 13,
            color: "var(--text-secondary)",
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {content || "Processing..."}
          {isStreaming && (
            <span
              style={{
                display: "inline-block",
                width: 2,
                height: 14,
                background: "#f472b6",
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
        borderRadius: 8,
        border: "1px solid rgba(236, 72, 153, 0.25)",
        background: "rgba(236, 72, 153, 0.05)",
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
          background: "rgba(236, 72, 153, 0.08)",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          font: "inherit",
        }}
      >
        <span className={isActive ? "animate-brain" : ""} style={{ fontSize: 16 }}>
          🧠
        </span>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#f472b6" }}>
          Reasoning Trace
        </span>
        <span
          style={{
            fontSize: 10,
            padding: "2px 6px",
            background: "rgba(236, 72, 153, 0.2)",
            borderRadius: 8,
            color: "#f9a8d4",
          }}
        >
          {steps.length} step{steps.length !== 1 ? "s" : ""}
        </span>
        {isActive && (
          <span style={{ fontSize: 10, color: "#f472b6", marginLeft: "auto" }}>
            Active
          </span>
        )}
        <svg
          width={14}
          height={14}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          style={{
            color: "#f472b6",
            transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.15s",
            marginLeft: isActive ? 0 : "auto",
          }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {/* Steps */}
      {isExpanded && (
        <div style={{ padding: "8px 12px" }}>
          {steps.map((step, idx) => (
            <div
              key={step.id}
              style={{
                position: "relative",
                paddingLeft: 20,
                paddingBottom: idx < steps.length - 1 || isActive ? 12 : 0,
                borderLeft: "2px solid rgba(236, 72, 153, 0.3)",
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
                  background: "#f472b6",
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
                borderLeft: "2px solid rgba(236, 72, 153, 0.3)",
                marginLeft: 6,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: -5,
                  top: 4,
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "#f472b6",
                  animation: "pulse 1.5s infinite",
                }}
              />
              <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                {currentContent}
                <span
                  style={{
                    display: "inline-block",
                    width: 2,
                    height: 12,
                    background: "#f472b6",
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
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.8); }
        }
        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
