"use client";

export interface PlanStep {
  id: string;
  label: string;
  status: "pending" | "in_progress" | "completed" | "failed";
}

export interface ChecklistItem {
  id: string;
  label: string;
  checked: boolean;
}

export interface ActivityCardProps {
  type: "plan" | "progress" | "checklist" | "search";
  title: string;
  // Plan
  steps?: PlanStep[];
  currentStep?: number;
  // Progress
  current?: number;
  total?: number;
  message?: string;
  // Checklist
  items?: ChecklistItem[];
  onItemToggle?: (id: string, checked: boolean) => void;
  // Search
  query?: string;
  results?: Array<{ title: string; snippet?: string }>;
  isSearching?: boolean;
}

const STATUS_ICONS = {
  pending: "○",
  in_progress: "◐",
  completed: "●",
  failed: "✕",
};

const STATUS_COLORS = {
  pending: "text-[var(--text-muted)]",
  in_progress: "text-blue-400",
  completed: "text-green-400",
  failed: "text-red-400",
};

export function ActivityCard({
  type,
  title,
  steps = [],
  currentStep = 0,
  current = 0,
  total = 100,
  message,
  items = [],
  onItemToggle,
  query,
  results = [],
  isSearching = false,
}: ActivityCardProps) {
  const progress = total > 0 ? Math.round((current / total) * 100) : 0;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] p-4 max-w-sm animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">
          {type === "plan" && "📋"}
          {type === "progress" && "⏳"}
          {type === "checklist" && "☑️"}
          {type === "search" && "🔍"}
        </span>
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
        {type === "progress" && (
          <span className="ml-auto text-xs font-mono text-[var(--text-muted)]">
            {progress}%
          </span>
        )}
        {isSearching && (
          <div className="ml-auto">
            <div className="tool-spinner" />
          </div>
        )}
      </div>

      {/* Plan Steps */}
      {type === "plan" && steps.length > 0 && (
        <div className="space-y-2">
          {steps.map((step, idx) => (
            <div
              key={step.id}
              className={`flex items-center gap-2 text-sm ${
                idx === currentStep ? "font-medium" : ""
              }`}
            >
              <span className={STATUS_COLORS[step.status]}>
                {STATUS_ICONS[step.status]}
              </span>
              <span
                className={
                  step.status === "completed"
                    ? "text-[var(--text-muted)] line-through"
                    : step.status === "in_progress"
                    ? "text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)]"
                }
              >
                {step.label}
              </span>
              {step.status === "in_progress" && (
                <span className="ml-auto text-[10px] text-blue-400">Running</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Progress Bar */}
      {type === "progress" && (
        <div>
          <div className="h-2 bg-[var(--bg-primary)] rounded-full overflow-hidden mb-2">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          {message && (
            <p className="text-xs text-[var(--text-secondary)]">{message}</p>
          )}
          <p className="text-[10px] text-[var(--text-muted)] mt-1">
            {current} of {total} completed
          </p>
        </div>
      )}

      {/* Checklist */}
      {type === "checklist" && items.length > 0 && (
        <div className="space-y-2">
          {items.map((item) => (
            <label
              key={item.id}
              className="flex items-center gap-2 cursor-pointer group"
            >
              <input
                type="checkbox"
                checked={item.checked}
                onChange={(e) => onItemToggle?.(item.id, e.target.checked)}
                className="w-4 h-4 rounded border-[var(--border)] bg-[var(--bg-primary)]"
              />
              <span
                className={`text-sm ${
                  item.checked
                    ? "text-[var(--text-muted)] line-through"
                    : "text-[var(--text-primary)] group-hover:text-[var(--accent)]"
                }`}
              >
                {item.label}
              </span>
            </label>
          ))}
          <div className="text-[10px] text-[var(--text-muted)] pt-2 border-t border-[var(--border)]">
            {items.filter((i) => i.checked).length} of {items.length} completed
          </div>
        </div>
      )}

      {/* Search */}
      {type === "search" && (
        <div>
          {query && (
            <div className="text-xs text-[var(--text-secondary)] mb-2 font-mono bg-[var(--bg-primary)] px-2 py-1 rounded">
              {query}
            </div>
          )}
          {results.length > 0 ? (
            <div className="space-y-2 max-h-48 overflow-auto">
              {results.map((result, idx) => (
                <div
                  key={idx}
                  className="text-sm p-2 rounded bg-[var(--bg-primary)] border border-[var(--border)]"
                >
                  <div className="font-medium text-[var(--text-primary)]">
                    {result.title}
                  </div>
                  {result.snippet && (
                    <div className="text-xs text-[var(--text-muted)] mt-1 line-clamp-2">
                      {result.snippet}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : !isSearching ? (
            <div className="text-xs text-[var(--text-muted)] italic">
              No results yet
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
