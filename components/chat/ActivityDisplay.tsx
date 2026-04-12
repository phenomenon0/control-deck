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
        borderRadius: 6,
        border: "1px solid var(--border)",
        background: "var(--bg-secondary)",
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
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>{title}</span>
        <span
          style={{
            fontSize: 10,
            padding: "2px 6px",
            background: "var(--bg-tertiary)",
            borderRadius: 8,
            color: "var(--text-muted)",
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
              padding: "5px 0",
            }}
          >
            {/* Status dot */}
            <span style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: step.status === "complete" ? "var(--success)"
                : step.status === "active" ? "var(--accent)"
                : step.status === "error" ? "var(--error)"
                : "var(--border-bright)",
              flexShrink: 0,
            }} />
            {/* Label */}
            <span
              style={{
                fontSize: 12,
                color:
                  step.status === "complete" ? "var(--text-muted)" :
                  step.status === "active" ? "var(--text-primary)" :
                  step.status === "error" ? "var(--error)" :
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
                className="animate-status-pulse"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "var(--accent)",
                }}
              />
            )}
          </div>
        ))}
      </div>
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
        borderRadius: 6,
        border: "1px solid var(--border)",
        background: "var(--bg-secondary)",
        padding: "10px 12px",
        marginBottom: 8,
        maxWidth: 350,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>{title}</span>
        <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: "auto", fontFamily: "'Geist Mono', 'SF Mono', ui-monospace, monospace" }}>
          {percent}%
        </span>
      </div>

      {/* Progress bar - Apple style thin rounded */}
      <div
        style={{
          height: 4,
          background: "var(--bg-tertiary)",
          borderRadius: 2,
          overflow: "hidden",
          marginBottom: message ? 8 : 0,
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${percent}%`,
            background: "var(--accent)",
            borderRadius: 2,
            transition: "width 150ms cubic-bezier(0, 0, 0.2, 1)",
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
        borderRadius: 6,
        border: "1px solid var(--border)",
        background: "var(--bg-secondary)",
        marginBottom: 8,
        maxWidth: 400,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 12,
            color: "var(--text-secondary)",
            fontFamily: "'Geist Mono', 'SF Mono', ui-monospace, monospace",
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
            border: "2px solid var(--border)",
            borderTopColor: "var(--accent)",
            borderRadius: "50%",
            animation: "spin 0.8s linear infinite",
          }}
        />
      ) : resultCount !== undefined ? (
        <span
          style={{
            fontSize: 10,
            padding: "2px 6px",
            background: "var(--bg-tertiary)",
            borderRadius: 8,
            color: "var(--text-muted)",
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
        borderRadius: 6,
        border: "1px solid var(--border)",
        background: "var(--bg-secondary)",
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
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>{title}</span>
        <span
          style={{
            fontSize: 10,
            padding: "2px 6px",
            background: "var(--bg-tertiary)",
            borderRadius: 8,
            color: "var(--text-muted)",
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
              padding: "5px 0",
              cursor: onToggle ? "pointer" : "default",
            }}
          >
            <input
              type="checkbox"
              checked={item.checked}
              onChange={(e) => onToggle?.(item.id, e.target.checked)}
              disabled={!onToggle}
              style={{
                width: 16,
                height: 16,
                accentColor: "var(--accent)",
                borderRadius: 4,
              }}
            />
            <span
              style={{
                fontSize: 12,
                color: item.checked ? "var(--text-muted)" : "var(--text-primary)",
                textDecoration: item.checked ? "line-through" : "none",
                transition: "color 150ms cubic-bezier(0, 0, 0.2, 1)",
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
