/**
 * InterruptDialog - Approval dialog for Agent-GO tool calls
 * 
 * Shows when Agent-GO requests approval for a risky tool operation
 * (file writes, shell commands, etc.)
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import { AlertTriangle } from "lucide-react";

interface InterruptRequest {
  runId: string;
  toolCallId: string;
  toolName: string;
  args?: Record<string, unknown>;
}

interface InterruptDialogProps {
  request: InterruptRequest | null;
  onApprove: () => void;
  onReject: (reason?: string) => void;
}

const AGENTGO_URL = process.env.NEXT_PUBLIC_AGENTGO_URL ?? "http://localhost:4243";

/**
 * Call Agent-GO approval endpoint
 */
async function approveRun(runId: string): Promise<boolean> {
  try {
    const res = await fetch(`${AGENTGO_URL}/runs/${runId}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    return res.ok;
  } catch (err) {
    console.error("[InterruptDialog] Approve failed:", err);
    return false;
  }
}

/**
 * Call Agent-GO rejection endpoint
 */
async function rejectRun(runId: string, reason?: string): Promise<boolean> {
  try {
    const res = await fetch(`${AGENTGO_URL}/runs/${runId}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    return res.ok;
  } catch (err) {
    console.error("[InterruptDialog] Reject failed:", err);
    return false;
  }
}

export function InterruptDialog({ request, onApprove, onReject }: InterruptDialogProps) {
  const [isProcessing, setIsProcessing] = useState(false);

  const handleApprove = useCallback(async () => {
    if (!request) return;
    setIsProcessing(true);
    const success = await approveRun(request.runId);
    setIsProcessing(false);
    if (success) {
      onApprove();
    }
  }, [request, onApprove]);

  const handleReject = useCallback(async () => {
    if (!request) return;
    setIsProcessing(true);
    const success = await rejectRun(request.runId, "User rejected");
    setIsProcessing(false);
    if (success) {
      onReject("User rejected");
    }
  }, [request, onReject]);

  // Escape key dismisses dialog (rejects the request)
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

  // Format args for display
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
        {/* Header */}
        <div className="interrupt-header">
          <div className={`interrupt-header-icon interrupt-header-icon--${riskModifier}`}>
            <AlertTriangle size={20} />
          </div>
          <div>
            <h3 className="interrupt-title">Approval Required</h3>
            <p className="interrupt-subtitle">The assistant wants to execute a tool</p>
          </div>
        </div>

        {/* Tool info */}
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

        {/* Actions */}
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

export type { InterruptRequest };
