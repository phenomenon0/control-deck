"use client";

// =============================================================================
// Types
// =============================================================================

export interface PlanStep {
  id: string;
  label: string;
  status: "pending" | "active" | "complete" | "error";
}

export interface ActivityPlanProps {
  title: string;
  steps: PlanStep[];
  currentStep?: number;
}

export interface ActivityProgressProps {
  title: string;
  current: number;
  total: number;
  message?: string;
}

export interface ActivitySearchProps {
  query: string;
  isSearching?: boolean;
  resultCount?: number;
}

// =============================================================================
// ActivityPlan - Shows multi-step plan
// =============================================================================

export function ActivityPlan({ title, steps, currentStep = 0 }: ActivityPlanProps) {
  const completedCount = steps.filter(s => s.status === "complete").length;
  
  return (
    <div
      style={{
        borderRadius: 8,
        border: "1px solid rgba(99, 102, 241, 0.25)",
        background: "rgba(99, 102, 241, 0.05)",
        overflow: "hidden",
        marginBottom: 8,
        maxWidth: 400,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          background: "rgba(99, 102, 241, 0.08)",
          borderBottom: "1px solid rgba(99, 102, 241, 0.15)",
        }}
      >
        <span style={{ fontSize: 14 }}>📋</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#818cf8" }}>{title}</span>
        <span
          style={{
            fontSize: 10,
            padding: "2px 6px",
            background: "rgba(99, 102, 241, 0.2)",
            borderRadius: 8,
            color: "#a5b4fc",
            marginLeft: "auto",
          }}
        >
          {completedCount}/{steps.length}
        </span>
      </div>

      {/* Steps */}
      <div style={{ padding: "8px 12px" }}>
        {steps.map((step, idx) => (
          <div
            key={step.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "4px 0",
            }}
          >
            {/* Status icon */}
            <span style={{ fontSize: 12, width: 16, textAlign: "center" }}>
              {step.status === "complete" && "✓"}
              {step.status === "active" && "◐"}
              {step.status === "pending" && "○"}
              {step.status === "error" && "✕"}
            </span>
            {/* Label */}
            <span
              style={{
                fontSize: 12,
                color:
                  step.status === "complete" ? "var(--text-muted)" :
                  step.status === "active" ? "var(--text-primary)" :
                  step.status === "error" ? "#f87171" :
                  "var(--text-secondary)",
                textDecoration: step.status === "complete" ? "line-through" : "none",
                flex: 1,
              }}
            >
              {step.label}
            </span>
            {/* Active indicator */}
            {step.status === "active" && (
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#818cf8",
                  animation: "pulse 1.5s infinite",
                }}
              />
            )}
          </div>
        ))}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}

// =============================================================================
// ActivityProgress - Shows progress bar
// =============================================================================

export function ActivityProgress({ title, current, total, message }: ActivityProgressProps) {
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;
  
  return (
    <div
      style={{
        borderRadius: 8,
        border: "1px solid rgba(99, 102, 241, 0.25)",
        background: "rgba(99, 102, 241, 0.05)",
        padding: "10px 12px",
        marginBottom: 8,
        maxWidth: 350,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 14 }}>⏳</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#818cf8" }}>{title}</span>
        <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: "auto", fontFamily: "ui-monospace, monospace" }}>
          {percent}%
        </span>
      </div>

      {/* Progress bar */}
      <div
        style={{
          height: 6,
          background: "rgba(99, 102, 241, 0.15)",
          borderRadius: 3,
          overflow: "hidden",
          marginBottom: message ? 8 : 0,
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${percent}%`,
            background: "linear-gradient(90deg, #6366f1, #8b5cf6)",
            borderRadius: 3,
            transition: "width 0.3s ease",
          }}
        />
      </div>

      {/* Message */}
      {message && (
        <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{message}</div>
      )}

      {/* Count */}
      <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
        {current} of {total}
      </div>
    </div>
  );
}

// =============================================================================
// ActivitySearch - Shows search status
// =============================================================================

export function ActivitySearch({ query, isSearching = false, resultCount }: ActivitySearchProps) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 12px",
        borderRadius: 8,
        border: "1px solid rgba(59, 130, 246, 0.25)",
        background: "rgba(59, 130, 246, 0.05)",
        marginBottom: 8,
        maxWidth: 400,
      }}
    >
      <span style={{ fontSize: 14 }}>🔍</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 11,
            color: "#60a5fa",
            fontFamily: "ui-monospace, monospace",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {query}
        </div>
      </div>
      {isSearching ? (
        <span
          style={{
            width: 12,
            height: 12,
            border: "2px solid rgba(59, 130, 246, 0.3)",
            borderTopColor: "#3b82f6",
            borderRadius: "50%",
            animation: "spin 0.8s linear infinite",
          }}
        />
      ) : resultCount !== undefined ? (
        <span
          style={{
            fontSize: 10,
            padding: "2px 6px",
            background: "rgba(59, 130, 246, 0.2)",
            borderRadius: 8,
            color: "#93c5fd",
          }}
        >
          {resultCount} result{resultCount !== 1 ? "s" : ""}
        </span>
      ) : null}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

// =============================================================================
// ActivityChecklist - Interactive checklist
// =============================================================================

export interface ChecklistItem {
  id: string;
  label: string;
  checked: boolean;
}

export interface ActivityChecklistProps {
  title: string;
  items: ChecklistItem[];
  onToggle?: (id: string, checked: boolean) => void;
}

export function ActivityChecklist({ title, items, onToggle }: ActivityChecklistProps) {
  const checkedCount = items.filter(i => i.checked).length;
  
  return (
    <div
      style={{
        borderRadius: 8,
        border: "1px solid rgba(34, 197, 94, 0.25)",
        background: "rgba(34, 197, 94, 0.05)",
        overflow: "hidden",
        marginBottom: 8,
        maxWidth: 350,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          background: "rgba(34, 197, 94, 0.08)",
          borderBottom: "1px solid rgba(34, 197, 94, 0.15)",
        }}
      >
        <span style={{ fontSize: 14 }}>☑️</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#4ade80" }}>{title}</span>
        <span
          style={{
            fontSize: 10,
            padding: "2px 6px",
            background: "rgba(34, 197, 94, 0.2)",
            borderRadius: 8,
            color: "#86efac",
            marginLeft: "auto",
          }}
        >
          {checkedCount}/{items.length}
        </span>
      </div>

      {/* Items */}
      <div style={{ padding: "6px 12px" }}>
        {items.map((item) => (
          <label
            key={item.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "4px 0",
              cursor: onToggle ? "pointer" : "default",
            }}
          >
            <input
              type="checkbox"
              checked={item.checked}
              onChange={(e) => onToggle?.(item.id, e.target.checked)}
              disabled={!onToggle}
              style={{
                width: 14,
                height: 14,
                accentColor: "#22c55e",
              }}
            />
            <span
              style={{
                fontSize: 12,
                color: item.checked ? "var(--text-muted)" : "var(--text-primary)",
                textDecoration: item.checked ? "line-through" : "none",
              }}
            >
              {item.label}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
