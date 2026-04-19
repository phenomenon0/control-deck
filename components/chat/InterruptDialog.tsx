"use client";

import { useState, useEffect, useCallback } from "react";
import { AlertTriangle } from "lucide-react";
import type { InterruptRequest } from "@/lib/hooks/useAgentRun";

interface InterruptDialogProps {
  request: InterruptRequest | null;
  onApprove: () => void;
  onReject: (reason?: string) => void;
}

async function postDecision(
  path: "approve" | "reject",
  runId: string,
  reason?: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/chat/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(path === "reject" ? { runId, reason } : { runId }),
    });
    if (res.ok) return { ok: true };
    const text = await res.text().catch(() => "");
    let message = text || `HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(text);
      if (parsed?.error) message = parsed.error;
    } catch {
      // not JSON, keep raw text
    }
    return { ok: false, error: message };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Network error" };
  }
}

export function InterruptDialog({ request, onApprove, onReject }: InterruptDialogProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
  }, [request]);

  const handleApprove = useCallback(async () => {
    if (!request) return;
    setError(null);
    setIsProcessing(true);
    const result = await postDecision("approve", request.runId);
    setIsProcessing(false);
    if (result.ok) {
      onApprove();
    } else {
      setError(result.error ?? "Approval failed");
    }
  }, [request, onApprove]);

  const handleReject = useCallback(async () => {
    if (!request) return;
    setError(null);
    setIsProcessing(true);
    const result = await postDecision("reject", request.runId, "User rejected");
    setIsProcessing(false);
    if (result.ok) {
      onReject("User rejected");
    } else {
      setError(result.error ?? "Rejection failed");
    }
  }, [request, onReject]);

  useEffect(() => {
    if (!request) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isProcessing) {
        handleReject();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [request, isProcessing, handleReject]);

  if (!request) return null;

  const formatArgs = (args: Record<string, unknown> | undefined) => {
    if (!args) return null;
    return Object.entries(args).map(([key, value]) => {
      const displayValue = typeof value === "string"
        ? (value.length > 100 ? value.slice(0, 100) + "..." : value)
        : JSON.stringify(value).slice(0, 100);
      return (
        <div key={key} className="interrupt-arg-row">
          <span className="interrupt-arg-key">{key}:</span>{" "}
          <span className="interrupt-arg-value">{displayValue}</span>
        </div>
      );
    });
  };

  const isHighRisk = ["bash", "write_file", "edit_file"].includes(request.toolName);
  const riskModifier = isHighRisk ? "error" : "warning";

  return (
    <div className="interrupt-overlay">
      <div className="interrupt-modal">
        <div className="interrupt-header">
          <div className={`interrupt-header-icon interrupt-header-icon--${riskModifier}`}>
            <AlertTriangle size={20} />
          </div>
          <div>
            <h3 className="interrupt-title">Approval Required</h3>
            <p className="interrupt-subtitle">The assistant wants to execute a tool</p>
          </div>
        </div>

        <div className="interrupt-tool-info">
          <div className="interrupt-tool-row">
            <span className={`interrupt-tool-badge interrupt-tool-badge--${riskModifier}`}>
              {request.toolName}
            </span>
          </div>

          {request.args && (
            <div className="interrupt-args">
              {formatArgs(request.args)}
            </div>
          )}
        </div>

        {error && (
          <div className="interrupt-error" role="alert">
            {error}
          </div>
        )}

        <div className="interrupt-actions">
          <button
            onClick={handleReject}
            disabled={isProcessing}
            className="interrupt-btn interrupt-btn--reject"
          >
            Reject
          </button>
          <button
            onClick={handleApprove}
            disabled={isProcessing}
            className="interrupt-btn interrupt-btn--approve"
          >
            {isProcessing ? "Processing..." : "Approve"}
          </button>
        </div>
      </div>
    </div>
  );
}
