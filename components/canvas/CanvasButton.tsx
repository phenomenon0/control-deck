"use client";

/**
 * CanvasButton - Inline button to open content in the canvas panel
 * 
 * Usage:
 * - On code blocks to open in canvas for editing/running
 * - On artifacts to view in the side panel
 * - On tool results to expand details
 */

import React from "react";
import { Maximize2, Code2, Eye, Play } from "lucide-react";
import { useCanvas } from "@/lib/hooks/useCanvas";
import { openCanvas as busOpenCanvas } from "@/lib/canvas/bus";

function ExpandIcon({ size = 14 }: { size?: number }) {
  return <Maximize2 width={size} height={size} />;
}

function CodeIcon({ size = 14 }: { size?: number }) {
  return <Code2 width={size} height={size} />;
}

function EyeIcon({ size = 14 }: { size?: number }) {
  return <Eye width={size} height={size} />;
}

interface CanvasButtonProps {
  variant?: "code" | "preview" | "image" | "artifact";
  label?: string;
  className?: string;
  onClick?: () => void;
}

interface OpenCodeButtonProps {
  code: string;
  language: string;
  title?: string;
  className?: string;
}

interface OpenPreviewButtonProps {
  html: string;
  title?: string;
  className?: string;
}

interface OpenArtifactButtonProps {
  artifact: {
    id: string;
    url: string;
    name: string;
    mimeType: string;
  };
  className?: string;
}

export function CanvasButton({ variant = "code", label, className, onClick }: CanvasButtonProps) {
  const Icon = variant === "code" ? CodeIcon : variant === "preview" ? EyeIcon : ExpandIcon;
  const defaultLabel = variant === "code" ? "Open in Canvas" : variant === "preview" ? "Preview" : "Expand";
  
  return (
    <button
      onClick={onClick}
      className={`
        inline-flex items-center gap-1.5 px-2 py-1 text-xs font-medium
        text-[var(--text-secondary)] hover:text-white bg-[var(--bg-tertiary)] hover:bg-[var(--bg-tertiary)]
        border border-[var(--border-bright)] rounded transition-colors
        ${className || ""}
      `}
    >
      <Icon size={12} />
      <span>{label || defaultLabel}</span>
    </button>
  );
}

export function OpenCodeButton({ code, language, title, className }: OpenCodeButtonProps) {
  const { openCode } = useCanvas();
  
  const handleClick = () => {
    openCode(code, language, title || `${language} snippet`);
  };
  
  return (
    <CanvasButton
      variant="code"
      label="Edit in Canvas"
      className={className}
      onClick={handleClick}
    />
  );
}

export function OpenPreviewButton({ html, title, className }: OpenPreviewButtonProps) {
  const { openPreview } = useCanvas();
  
  const handleClick = () => {
    openPreview(html, title || "Preview");
  };
  
  return (
    <CanvasButton
      variant="preview"
      label="Open Preview"
      className={className}
      onClick={handleClick}
    />
  );
}

interface OpenInCanvasButtonProps {
  code: string;
  language: string;
  title?: string;
  autoRun?: boolean;
  label?: string;
  className?: string;
}

export function OpenInCanvasButton({ code, language, title, autoRun, label, className }: OpenInCanvasButtonProps) {
  const handleClick = () => {
    busOpenCanvas({ code, language, title, autoRun });
  };
  const Icon = autoRun ? Play : Code2;
  const defaultLabel = autoRun ? "Run in Canvas" : "Open in Canvas";
  return (
    <button
      onClick={handleClick}
      className={`inline-flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-[var(--text-secondary)] hover:text-white bg-[var(--bg-tertiary)] hover:bg-[var(--bg-tertiary)] border border-[var(--border-bright)] rounded transition-colors ${className || ""}`}
    >
      <Icon width={12} height={12} />
      <span>{label || defaultLabel}</span>
    </button>
  );
}

export function OpenArtifactButton({ artifact, className }: OpenArtifactButtonProps) {
  const { openArtifact } = useCanvas();
  
  const handleClick = () => {
    openArtifact(artifact);
  };
  
  return (
    <CanvasButton
      variant="artifact"
      label="Open in Canvas"
      className={className}
      onClick={handleClick}
    />
  );
}

interface CodeBlockWithCanvasProps {
  code: string;
  language?: string;
  showLineNumbers?: boolean;
}

export function CodeBlockWithCanvas({ code, language = "text", showLineNumbers = false }: CodeBlockWithCanvasProps) {
  const { openCode } = useCanvas();
  const [copied, setCopied] = React.useState(false);
  
  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  
  const handleOpenCanvas = () => {
    openCode(code, language, `${language} code`);
  };
  
  const lines = code.split("\n");
  
  return (
    <div className="relative group rounded-lg overflow-hidden border border-[var(--border)] bg-[var(--bg-secondary)] my-2">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[var(--bg-tertiary)] border-b border-[var(--border)]">
        <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">{language}</span>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={handleCopy}
            className="px-2 py-0.5 text-[10px] text-[var(--text-secondary)] hover:text-white bg-[var(--bg-tertiary)] rounded transition-colors"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
          <button
            onClick={handleOpenCanvas}
            className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-[var(--text-secondary)] hover:text-white bg-[var(--bg-tertiary)] rounded transition-colors"
          >
            <ExpandIcon size={10} />
            Canvas
          </button>
        </div>
      </div>
      
      {/* Code */}
      <pre className="p-4 overflow-x-auto text-sm font-mono">
        {showLineNumbers ? (
          <table className="w-full">
            <tbody>
              {lines.map((line, i) => (
                <tr key={i}>
                  <td className="pr-4 text-right text-[var(--text-muted)] select-none w-8">{i + 1}</td>
                  <td className="text-[var(--text-primary)]">{line}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <code className="text-[var(--text-primary)] whitespace-pre-wrap">{code}</code>
        )}
      </pre>
    </div>
  );
}

export default CanvasButton;
