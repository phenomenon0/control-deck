/**
 * InterruptDialog - Approval dialog for Agent-GO tool calls
 * 
 * Shows when Agent-GO requests approval for a risky tool operation
 * (file writes, shell commands, etc.)
 */

"use client";

import { useState } from "react";

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

  if (!request) return null;

  const handleApprove = async () => {
    setIsProcessing(true);
    const success = await approveRun(request.runId);
    setIsProcessing(false);
    if (success) {
      onApprove();
    }
  };

  const handleReject = async () => {
    setIsProcessing(true);
    const success = await rejectRun(request.runId, "User rejected");
    setIsProcessing(false);
    if (success) {
      onReject("User rejected");
    }
  };

  // Format args for display
  const formatArgs = (args: Record<string, unknown> | undefined) => {
    if (!args) return null;
    return Object.entries(args).map(([key, value]) => {
      const displayValue = typeof value === "string" 
        ? (value.length > 100 ? value.slice(0, 100) + "..." : value)
        : JSON.stringify(value).slice(0, 100);
      return (
        <div key={key} style={{ marginBottom: 4 }}>
          <span style={{ color: "var(--text-muted)", fontFamily: "monospace" }}>{key}:</span>{" "}
          <span style={{ fontFamily: "monospace" }}>{displayValue}</span>
        </div>
      );
    });
  };

  // Risk level styling
  const getRiskColor = (toolName: string) => {
    if (["bash", "write_file", "edit_file"].includes(toolName)) {
      return "#ef4444"; // red for high risk
    }
    return "#f59e0b"; // amber for medium risk
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: "var(--bg-primary)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: 24,
          maxWidth: 480,
          width: "90%",
          boxShadow: "0 4px 24px rgba(0, 0, 0, 0.2)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 8,
              background: `${getRiskColor(request.toolName)}20`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 20,
            }}
          >
            ⚠️
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: 18, color: "var(--text-primary)" }}>
              Approval Required
            </h3>
            <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
              The assistant wants to execute a tool
            </p>
          </div>
        </div>

        {/* Tool info */}
        <div
          style={{
            background: "var(--bg-secondary)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: 12,
            marginBottom: 16,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span
              style={{
                background: `${getRiskColor(request.toolName)}30`,
                color: getRiskColor(request.toolName),
                padding: "2px 8px",
                borderRadius: 4,
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {request.toolName}
            </span>
          </div>
          
          {request.args && (
            <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              {formatArgs(request.args)}
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
          <button
            onClick={handleReject}
            disabled={isProcessing}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--bg-secondary)",
              color: "var(--text-primary)",
              cursor: isProcessing ? "not-allowed" : "pointer",
              fontSize: 14,
              fontWeight: 500,
              opacity: isProcessing ? 0.6 : 1,
            }}
          >
            Reject
          </button>
          <button
            onClick={handleApprove}
            disabled={isProcessing}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: "none",
              background: "var(--accent)",
              color: "white",
              cursor: isProcessing ? "not-allowed" : "pointer",
              fontSize: 14,
              fontWeight: 500,
              opacity: isProcessing ? 0.6 : 1,
            }}
          >
            {isProcessing ? "Processing..." : "Approve"}
          </button>
        </div>
      </div>
    </div>
  );
}

export type { InterruptRequest };
