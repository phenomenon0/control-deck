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

  const isHighRisk = ["bash", "write_file", "edit_file"].includes(request.toolName);
  const riskModifier = isHighRisk ? "error" : "warning";
  const payload = JSON.stringify(
    {
      tool: request.toolName,
      args: request.args ?? {},
    },
    null,
    2,
  );
  const riskCopy = isHighRisk
    ? "This can change files or execute commands. Review the payload before continuing."
    : "The assistant needs your approval before continuing this run.";

  return (
    <div className="interrupt-overlay">
      <div
        className="interrupt-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="interrupt-title"
      >
        <div className="interrupt-header">
          <div className={`interrupt-header-icon interrupt-header-icon--${riskModifier}`}>
            <AlertTriangle size={20} />
          </div>
          <div>
            <div className={`interrupt-kicker interrupt-kicker--${riskModifier}`}>
              Pending approval
            </div>
            <h3 id="interrupt-title" className="interrupt-title">
              Run {request.toolName}?
            </h3>
            <p className="interrupt-subtitle">{riskCopy}</p>
          </div>
        </div>

        <div className="interrupt-tool-info">
          <div className="interrupt-tool-row">
            <span className={`interrupt-tool-badge interrupt-tool-badge--${riskModifier}`}>
              {isHighRisk ? "high risk" : "review"}
            </span>
            <span className="interrupt-tool-name">{request.toolName}</span>
          </div>

          <pre className="interrupt-args">{payload}</pre>
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
            Deny
          </button>
          <button
            onClick={handleApprove}
            disabled={isProcessing}
            className="interrupt-btn interrupt-btn--approve"
          >
            {isProcessing ? "Processing..." : "Approve & run"}
          </button>
        </div>
      </div>
    </div>
  );
}
