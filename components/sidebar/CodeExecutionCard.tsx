"use client";

import { useState } from "react";
import type { ToolCallData } from "@/components/chat/ToolCallCard";

interface CodeExecutionCardProps {
  tool: ToolCallData;
}

export function CodeExecutionCard({ tool }: CodeExecutionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [isRerunning, setIsRerunning] = useState(false);
  const [editedCode, setEditedCode] = useState<string | null>(null);
  const [rerunResult, setRerunResult] = useState<{
    stdout?: string;
    stderr?: string;
    exitCode: number;
    durationMs?: number;
  } | null>(null);

  // Extract code execution data
  const code = tool.args?.code as string || "";
  const language = tool.args?.language as string || "python";
  const data = tool.result?.data as {
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    durationMs?: number;
    preview?: { html?: string; bundled?: string };
    images?: Array<{ name: string; mimeType: string; data: string }>;
  } | undefined;

  const stdout = rerunResult?.stdout ?? data?.stdout ?? "";
  const stderr = rerunResult?.stderr ?? data?.stderr ?? "";
  const exitCode = rerunResult?.exitCode ?? data?.exitCode ?? 0;
  const durationMs = rerunResult?.durationMs ?? data?.durationMs ?? tool.durationMs;

  const displayCode = editedCode ?? code;
  const codeLines = displayCode.split("\n");
  const previewLines = expanded ? codeLines : codeLines.slice(0, 5);
  const hasMoreLines = codeLines.length > 5;

  const handleRerun = async () => {
    setIsRerunning(true);
    try {
      const response = await fetch("/api/code/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          code: editedCode ?? code, 
          language 
        }),
      });
      
      if (response.ok) {
        const result = await response.json();
        setRerunResult({
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
        });
      } else {
        setRerunResult({
          stdout: "",
          stderr: "Failed to execute code",
          exitCode: 1,
        });
      }
    } catch (error) {
      setRerunResult({
        stdout: "",
        stderr: String(error),
        exitCode: 1,
      });
    } finally {
      setIsRerunning(false);
    }
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(displayCode);
  };

  const handleCopyOutput = () => {
    navigator.clipboard.writeText(stdout || stderr);
  };

  return (
    <div className="result-card code-card">
      <div className="result-card-header">
        <span className="result-icon">💻</span>
        <span className="result-title">execute code</span>
        <span className="code-language">{language}</span>
        <span className={`exit-badge ${exitCode === 0 ? "success" : "error"}`}>
          {exitCode === 0 ? "✓" : "✗"} {exitCode}
        </span>
        {durationMs && <span className="result-duration">{durationMs}ms</span>}
      </div>

      <div className="result-card-body">
        {/* Code Block */}
        <div className="code-block-container">
          <div className="code-block-header">
            <span>Code</span>
            <div className="code-block-actions">
              <button className="code-action-btn" onClick={handleCopyCode} title="Copy code">
                📋
              </button>
              {!expanded && hasMoreLines && (
                <button className="code-action-btn" onClick={() => setExpanded(true)}>
                  +{codeLines.length - 5} lines
                </button>
              )}
            </div>
          </div>
          <pre className="code-block">
            <code className={`language-${language}`}>
              {previewLines.join("\n")}
              {!expanded && hasMoreLines && "\n..."}
            </code>
          </pre>
          {expanded && (
            <div className="code-edit-area">
              <textarea
                value={editedCode ?? code}
                onChange={(e) => setEditedCode(e.target.value)}
                className="code-editor"
                spellCheck={false}
              />
            </div>
          )}
        </div>

        {/* Output Block */}
        {(stdout || stderr) && (
          <div className="code-output-container">
            <div className="code-block-header">
              <span>{stderr ? "Output / Errors" : "Output"}</span>
              <button className="code-action-btn" onClick={handleCopyOutput} title="Copy output">
                📋
              </button>
            </div>
            <pre className="code-output">
              {stdout && <span className="stdout">{stdout}</span>}
              {stderr && <span className="stderr">{stderr}</span>}
            </pre>
          </div>
        )}

        {/* Actions */}
        <div className="result-card-actions">
          <button
            className="action-btn primary"
            onClick={handleRerun}
            disabled={isRerunning}
          >
            {isRerunning ? "⟳ Running..." : "▶ Re-run"}
          </button>
          <button
            className="action-btn"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "↑ Collapse" : "↓ Expand"}
          </button>
          <button
            className="action-btn"
            onClick={handleCopyCode}
          >
            📋 Copy
          </button>
        </div>

        {/* Preview (if available) */}
        {data?.preview?.bundled && (
          <div className="code-preview">
            <div className="code-block-header">
              <span>Preview</span>
            </div>
            <iframe
              srcDoc={data.preview.bundled}
              className="code-preview-iframe"
              sandbox="allow-scripts"
              title="Code Preview"
            />
          </div>
        )}

        {/* Generated Images (if any) */}
        {data?.images && data.images.length > 0 && (
          <div className="code-images">
            <div className="code-block-header">
              <span>Generated Images ({data.images.length})</span>
            </div>
            <div className="code-images-grid">
              {data.images.map((img, idx) => (
                <img
                  key={idx}
                  src={`data:${img.mimeType};base64,${img.data}`}
                  alt={img.name}
                  className="code-image"
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
