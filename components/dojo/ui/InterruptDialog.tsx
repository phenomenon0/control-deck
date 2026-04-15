"use client";

import { useState } from "react";

export interface InterruptDialogProps {
  title: string;
  description: string;
  type: "approval" | "input" | "confirmation";
  riskLevel?: "low" | "medium" | "high" | "critical";
  fields?: Array<{
    name: string;
    label: string;
    type: "text" | "number" | "email" | "select" | "checkbox" | "textarea";
    required?: boolean;
    options?: string[];
    defaultValue?: string | number | boolean;
  }>;
  onApprove?: (data?: Record<string, unknown>) => void;
  onReject?: (reason?: string) => void;
  isOpen?: boolean;
}

const RISK_STYLES = {
  low: {
    border: "border-green-500/30",
    bg: "bg-green-500/10",
    icon: "text-green-400",
    badge: "bg-green-500/20 text-green-400",
  },
  medium: {
    border: "border-yellow-500/30",
    bg: "bg-yellow-500/10",
    icon: "text-yellow-400",
    badge: "bg-yellow-500/20 text-yellow-400",
  },
  high: {
    border: "border-orange-500/30",
    bg: "bg-orange-500/10",
    icon: "text-orange-400",
    badge: "bg-orange-500/20 text-orange-400",
  },
  critical: {
    border: "border-red-500/30",
    bg: "bg-red-500/10",
    icon: "text-red-400",
    badge: "bg-red-500/20 text-red-400",
  },
};

export function InterruptDialog({
  title,
  description,
  type,
  riskLevel = "medium",
  fields = [],
  onApprove,
  onReject,
  isOpen = true,
}: InterruptDialogProps) {
  const [formData, setFormData] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    fields.forEach((f) => {
      if (f.defaultValue !== undefined) {
        initial[f.name] = f.defaultValue;
      }
    });
    return initial;
  });
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);

  const styles = RISK_STYLES[riskLevel];

  if (!isOpen) return null;

  const handleFieldChange = (name: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleApprove = () => {
    onApprove?.(fields.length > 0 ? formData : undefined);
  };

  const handleReject = () => {
    if (showRejectInput) {
      onReject?.(rejectReason || undefined);
    } else {
      setShowRejectInput(true);
    }
  };

  return (
    <div className={`rounded-lg border-2 ${styles.border} ${styles.bg} p-4 max-w-md animate-fade-in`}>
      {/* Header */}
      <div className="flex items-start gap-3 mb-4">
        <div className={`text-2xl ${styles.icon}`}>
          {type === "approval" && "✋"}
          {type === "input" && "📝"}
          {type === "confirmation" && "❓"}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${styles.badge}`}>
              {riskLevel.toUpperCase()}
            </span>
          </div>
          <p className="text-xs text-[var(--text-secondary)]">{description}</p>
        </div>
      </div>

      {/* Form Fields */}
      {fields.length > 0 && (
        <div className="space-y-3 mb-4">
          {fields.map((field) => (
            <div key={field.name}>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                {field.label}
                {field.required && <span className="text-red-400 ml-1">*</span>}
              </label>
              {field.type === "select" ? (
                <select
                  className="select w-full text-sm"
                  value={String(formData[field.name] || "")}
                  onChange={(e) => handleFieldChange(field.name, e.target.value)}
                >
                  <option value="">Select...</option>
                  {field.options?.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : field.type === "checkbox" ? (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(formData[field.name])}
                    onChange={(e) => handleFieldChange(field.name, e.target.checked)}
                    className="w-4 h-4 rounded border-[var(--border)] bg-[var(--bg-primary)]"
                  />
                  <span className="text-sm text-[var(--text-primary)]">Confirm</span>
                </label>
              ) : field.type === "textarea" ? (
                <textarea
                  className="input w-full text-sm min-h-[80px]"
                  value={String(formData[field.name] || "")}
                  onChange={(e) => handleFieldChange(field.name, e.target.value)}
                  placeholder={`Enter ${field.label.toLowerCase()}...`}
                />
              ) : (
                <input
                  type={field.type}
                  className="input w-full text-sm"
                  value={String(formData[field.name] || "")}
                  onChange={(e) =>
                    handleFieldChange(
                      field.name,
                      field.type === "number" ? Number(e.target.value) : e.target.value
                    )
                  }
                  placeholder={`Enter ${field.label.toLowerCase()}...`}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Reject Reason Input */}
      {showRejectInput && (
        <div className="mb-4 animate-fade-in">
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
            Reason for rejection (optional)
          </label>
          <input
            type="text"
            className="input w-full text-sm"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Enter reason..."
            autoFocus
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleApprove}
          className="btn btn-primary flex-1 text-sm"
        >
          {type === "approval" && "Approve"}
          {type === "input" && "Submit"}
          {type === "confirmation" && "Confirm"}
        </button>
        <button
          onClick={handleReject}
          className="btn btn-secondary flex-1 text-sm"
        >
          {showRejectInput ? "Send" : "Reject"}
        </button>
      </div>
    </div>
  );
}
