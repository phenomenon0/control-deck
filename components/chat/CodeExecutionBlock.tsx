"use client";

/**
 * CodeExecutionBlock - Displays code execution results with Canvas integration
 * 
 * Features:
 * - Compact inline preview of execution results
 * - "Open in Canvas" to expand to full editor with live preview
 * - Shows code, output, preview (React/HTML/Three.js), and images
 */

import { useState } from "react";
import { Maximize2 } from "lucide-react";
import { useCanvas } from "@/lib/hooks/useCanvas";

export interface CodeExecutionData {
  language: string;
  code: string;
  exitCode: number;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
  preview?: {
    html?: string;
    bundled?: string;
  };
  images?: Array<{
    name: string;
    mimeType: string;
    data: string;
  }>;
}

interface CodeExecutionBlockProps {
  data: CodeExecutionData;
  /** Optional: callback to re-run with modified code */
  onRerun?: (code: string) => void;
}

export function CodeExecutionBlock({ data, onRerun }: CodeExecutionBlockProps) {
  const { addTab, open } = useCanvas();
  const [expanded, setExpanded] = useState(false);
  
  const hasOutput = data.stdout || data.stderr;
  const hasPreview = !!data.preview?.bundled;
  const hasImages = data.images && data.images.length > 0;
  const isSuccess = data.exitCode === 0;
  
  const handleOpenCanvas = () => {
    addTab({
      type: "code",
      title: `${data.language} execution`,
      language: data.language,
      code: data.code,
      output: {
        stdout: data.stdout,
        stderr: data.stderr,
        exitCode: data.exitCode,
        durationMs: data.durationMs,
      },
      preview: data.preview,
      images: data.images,
      isEditable: true,
    });
  };
  
  return (
    <div
      style={{
        marginTop: 12,
        maxWidth: 500,
        border: "1px solid var(--border)",
        borderRadius: 6,
        overflow: "hidden",
        background: "var(--bg-secondary)",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Status indicator */}
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: isSuccess ? "var(--success)" : "var(--error)",
            }}
          />

          <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-primary)" }}>
            {data.language}
          </span>

          {data.durationMs !== undefined && (
            <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "'Geist Mono', 'SF Mono', ui-monospace, monospace" }}>
              {data.durationMs}ms
            </span>
          )}
        </div>
        
        {/* Actions */}
        <div style={{ display: "flex", gap: 4 }}>
          {(hasOutput || hasPreview || hasImages) && (
            <button
              onClick={() => setExpanded(!expanded)}
              style={{
                padding: "4px 10px",
                fontSize: 11,
                fontWeight: 500,
                color: "var(--text-secondary)",
                background: "var(--bg-tertiary)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                cursor: "pointer",
                transition: "all 150ms cubic-bezier(0, 0, 0.2, 1)",
              }}
            >
              {expanded ? "Collapse" : "Expand"}
            </button>
          )}

          <button
            onClick={handleOpenCanvas}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "4px 10px",
              fontSize: 11,
              fontWeight: 500,
              color: "var(--accent)",
              background: "rgba(94, 106, 210, 0.08)",
              border: "1px solid rgba(94, 106, 210, 0.15)",
              borderRadius: 6,
              cursor: "pointer",
              transition: "all 150ms cubic-bezier(0, 0, 0.2, 1)",
            }}
          >
            <Maximize2 width={10} height={10} />
            Canvas
          </button>
        </div>
      </div>
      
      {/* Summary line */}
      {!expanded && (
        <div style={{ padding: "8px 12px", fontSize: 12, color: "var(--text-secondary)" }}>
          {hasPreview && <span style={{ marginRight: 8 }}>Has preview</span>}
          {hasImages && <span style={{ marginRight: 8 }}>{data.images!.length} image(s)</span>}
          {hasOutput && (
            <span style={{ color: isSuccess ? "var(--text-secondary)" : "var(--error)" }}>
              {data.stdout ? `${data.stdout.split("\n").length} line(s) output` : ""}
              {data.stderr ? ` + errors` : ""}
            </span>
          )}
          {!hasOutput && !hasPreview && !hasImages && (
            <span style={{ color: "var(--text-muted)" }}>No output</span>
          )}
        </div>
      )}
      
      {/* Expanded content */}
      {expanded && (
        <div className="animate-expand" style={{ maxHeight: 300, overflow: "auto" }}>
          {/* Output */}
          {hasOutput && (
            <pre
              style={{
                padding: "10px 12px",
                margin: 0,
                fontSize: 12,
                fontFamily: "'Geist Mono', 'SF Mono', ui-monospace, monospace",
                whiteSpace: "pre-wrap",
                background: "#111113",
                color: "#D4D4D4",
              }}
            >
              {data.stdout && <span style={{ color: "#D4D4D4" }}>{data.stdout}</span>}
              {data.stderr && <span style={{ color: "var(--error)" }}>{data.stderr}</span>}
            </pre>
          )}
          
          {/* Preview indicator */}
          {hasPreview && (
            <div
              style={{
                padding: "8px 12px",
                borderTop: hasOutput ? "1px solid var(--border)" : "none",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                Preview available - open in Canvas to view
              </span>
            </div>
          )}
          
          {/* Images */}
          {hasImages && (
            <div
              style={{
                padding: "8px 12px",
                borderTop: hasOutput || hasPreview ? "1px solid var(--border)" : "none",
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
              }}
            >
              {data.images!.map((img, i) => (
                <img
                  key={i}
                  src={`data:${img.mimeType};base64,${img.data}`}
                  alt={img.name}
                  style={{
                    width: 80,
                    height: 80,
                    objectFit: "cover",
                    borderRadius: 4,
                    border: "1px solid var(--border)",
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default CodeExecutionBlock;
