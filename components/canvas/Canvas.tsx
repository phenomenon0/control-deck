"use client";

/**
 * Canvas Component - Rich output display for code execution, previews, and visualizations
 * 
 * Features:
 * - Code display with syntax highlighting
 * - Streaming output (stdout/stderr)
 * - Image/chart display
 * - HTML/React/Three.js preview in sandboxed iframe
 * - Tab navigation
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";

// Types
export interface CanvasProps {
  /** Source code to display */
  code?: string;
  /** Programming language for syntax highlighting */
  language?: string;
  /** Standard output */
  stdout?: string;
  /** Standard error */
  stderr?: string;
  /** Exit code from execution */
  exitCode?: number;
  /** Execution duration in ms */
  durationMs?: number;
  /** Whether execution is in progress */
  isRunning?: boolean;
  /** Error message */
  error?: string;
  /** Images from code execution */
  images?: Array<{
    name: string;
    mimeType: string;
    data: string; // base64
  }>;
  /** HTML preview content */
  preview?: {
    html?: string;
    bundled?: string;
  };
  /** Callback when user edits code */
  onCodeChange?: (code: string) => void;
  /** Callback when user clicks run */
  onRun?: () => void;
  /** Additional class name */
  className?: string;
}

type Tab = "code" | "output" | "preview" | "images";

export function Canvas({
  code,
  language = "text",
  stdout,
  stderr,
  exitCode,
  durationMs,
  isRunning,
  error,
  images,
  preview,
  onCodeChange,
  onRun,
  className,
}: CanvasProps) {
  const [activeTab, setActiveTab] = useState<Tab>("code");
  const [editableCode, setEditableCode] = useState(code ?? "");
  const outputRef = useRef<HTMLPreElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  
  // Update editable code when prop changes
  useEffect(() => {
    if (code !== undefined) {
      setEditableCode(code);
    }
  }, [code]);
  
  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [stdout, stderr]);
  
  // Switch to output tab when running
  useEffect(() => {
    if (isRunning && activeTab === "code") {
      setActiveTab("output");
    }
  }, [isRunning, activeTab]);
  
  // Switch to images tab when images available
  useEffect(() => {
    if (images && images.length > 0 && activeTab === "output") {
      setActiveTab("images");
    }
  }, [images, activeTab]);
  
  // Switch to preview tab when preview available
  useEffect(() => {
    if (preview?.bundled && activeTab === "output") {
      setActiveTab("preview");
    }
  }, [preview, activeTab]);
  
  // Load preview into iframe
  useEffect(() => {
    if (activeTab === "preview" && preview?.bundled && iframeRef.current) {
      const blob = new Blob([preview.bundled], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      iframeRef.current.src = url;
      return () => URL.revokeObjectURL(url);
    }
  }, [activeTab, preview]);
  
  // Determine available tabs
  const tabs: Tab[] = ["code", "output"];
  if (preview?.bundled) tabs.push("preview");
  if (images && images.length > 0) tabs.push("images");
  
  const handleCodeChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newCode = e.target.value;
    setEditableCode(newCode);
    onCodeChange?.(newCode);
  }, [onCodeChange]);
  
  const handleRun = useCallback(() => {
    onRun?.();
  }, [onRun]);
  
  return (
    <div className={cn("flex flex-col bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden", className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-zinc-800/50 border-b border-zinc-700">
        {/* Tabs */}
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "px-3 py-1 text-xs font-medium rounded transition-colors",
                activeTab === tab
                  ? "bg-zinc-700 text-white"
                  : "text-zinc-400 hover:text-white hover:bg-zinc-700/50"
              )}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
              {tab === "images" && images && ` (${images.length})`}
            </button>
          ))}
        </div>
        
        {/* Actions */}
        <div className="flex items-center gap-2">
          {language && (
            <span className="text-xs text-zinc-500">{language}</span>
          )}
          {durationMs !== undefined && (
            <span className="text-xs text-zinc-500">{durationMs}ms</span>
          )}
          {exitCode !== undefined && (
            <span className={cn(
              "text-xs px-1.5 py-0.5 rounded",
              exitCode === 0 
                ? "bg-green-500/20 text-green-400" 
                : "bg-red-500/20 text-red-400"
            )}>
              exit {exitCode}
            </span>
          )}
          {onRun && (
            <button
              onClick={handleRun}
              disabled={isRunning}
              className={cn(
                "px-2 py-1 text-xs font-medium rounded transition-colors",
                isRunning
                  ? "bg-zinc-700 text-zinc-400 cursor-not-allowed"
                  : "bg-green-600 hover:bg-green-500 text-white"
              )}
            >
              {isRunning ? "Running..." : "Run"}
            </button>
          )}
        </div>
      </div>
      
      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {/* Code Tab */}
        {activeTab === "code" && (
          <div className="h-full">
            {onCodeChange ? (
              <textarea
                value={editableCode}
                onChange={handleCodeChange}
                className="w-full h-full p-4 bg-transparent text-zinc-100 font-mono text-sm resize-none focus:outline-none"
                spellCheck={false}
                placeholder="Enter code..."
              />
            ) : (
              <pre className="h-full p-4 overflow-auto text-zinc-100 font-mono text-sm whitespace-pre-wrap">
                {code}
              </pre>
            )}
          </div>
        )}
        
        {/* Output Tab */}
        {activeTab === "output" && (
          <pre
            ref={outputRef}
            className="h-full p-4 overflow-auto text-sm font-mono whitespace-pre-wrap"
          >
            {isRunning && !stdout && !stderr && (
              <span className="text-zinc-500">Running...</span>
            )}
            {stdout && (
              <span className="text-zinc-100">{stdout}</span>
            )}
            {stderr && (
              <span className="text-red-400">{stderr}</span>
            )}
            {error && (
              <span className="text-red-400">{error}</span>
            )}
            {!isRunning && !stdout && !stderr && !error && (
              <span className="text-zinc-500">No output</span>
            )}
          </pre>
        )}
        
        {/* Preview Tab */}
        {activeTab === "preview" && preview?.bundled && (
          <div className="h-full bg-white">
            <iframe
              ref={iframeRef}
              className="w-full h-full border-0"
              sandbox="allow-scripts"
              title="Code Preview"
            />
          </div>
        )}
        
        {/* Images Tab */}
        {activeTab === "images" && images && images.length > 0 && (
          <div className="h-full p-4 overflow-auto">
            <div className="grid grid-cols-2 gap-4">
              {images.map((img, i) => (
                <div key={i} className="flex flex-col gap-2">
                  <img
                    src={`data:${img.mimeType};base64,${img.data}`}
                    alt={img.name}
                    className="w-full rounded border border-zinc-700"
                  />
                  <span className="text-xs text-zinc-500 text-center">{img.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Canvas;
