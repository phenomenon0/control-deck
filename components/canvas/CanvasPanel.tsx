"use client";

/**
 * CanvasPanel - Elite side panel for code, previews, and artifacts
 * 
 * Features:
 * - Tabbed interface for multiple items
 * - Live code editing with syntax highlighting
 * - Preview sandbox (React/HTML/Three.js)
 * - Image/audio/3D model viewers
 * - Streaming output display
 * - Resizable panel
 * 
 * Inspired by Claude Artifacts + ChatGPT Canvas + Cursor
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  X as CloseIcon,
  Play as PlayIcon,
  Copy as CopyIcon,
  Download as DownloadIcon,
  Maximize2 as MaximizeIcon,
  RefreshCw as RefreshIcon,
  Map as MapIcon,
  Undo2 as UndoIcon,
  Redo2 as RedoIcon,
  History as HistoryIcon,
} from "lucide-react";
import { useCanvas, useActiveCanvasTab, type CanvasTab } from "@/lib/hooks/useCanvas";
import { MonacoEditor } from "./MonacoEditor";

function TabBar() {
  const { tabs, activeTabId, setActiveTab, removeTab, close } = useCanvas();
  
  const getTabIcon = (type: CanvasTab["type"]) => {
    switch (type) {
      case "code": return "{ }";
      case "preview": return "[ ]";
      case "image": return "img";
      case "audio": return "snd";
      case "model3d": return "3D";
      case "document": return "doc";
      case "diagram": return "dia";
      default: return "?";
    }
  };
  
  return (
    <div className="flex items-center gap-1 px-2 py-1.5 bg-[var(--bg-secondary)] border-b border-[var(--border)] overflow-x-auto">
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          className={`
            group flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium
            transition-colors whitespace-nowrap
            ${activeTabId === tab.id 
              ? "bg-[var(--bg-tertiary)] text-white" 
              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"}
          `}
        >
          <span className="text-[10px] opacity-60">{getTabIcon(tab.type)}</span>
          <span className="max-w-[120px] truncate">{tab.title}</span>
          {tab.isRunning && (
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
          )}
          <button
            onClick={(e) => { e.stopPropagation(); removeTab(tab.id); }}
            className="opacity-0 group-hover:opacity-100 hover:text-[var(--error)] transition-opacity ml-1"
          >
            <CloseIcon size={12} />
          </button>
        </button>
      ))}
      
      <div className="flex-1" />
      
      <button
        onClick={close}
        className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        title="Close canvas"
      >
        <CloseIcon size={16} />
      </button>
    </div>
  );
}

function CodeView({ tab }: { tab: CanvasTab }) {
  const { updateTab, executeCode, saveRevision, undo, redo, canUndo, canRedo, getRevisions, goToRevision } = useCanvas();
  const [localCode, setLocalCode] = useState(tab.code || "");
  const [activeSubTab, setActiveSubTab] = useState<"code" | "output" | "preview" | "images" | "history">("code");
  const [copied, setCopied] = useState(false);
  const [showMinimap, setShowMinimap] = useState(false);
  const outputRef = useRef<HTMLPreElement>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Sync local code with tab
  useEffect(() => {
    setLocalCode(tab.code || "");
  }, [tab.code]);
  
  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [tab.output]);
  
  // Auto-switch tabs based on content
  useEffect(() => {
    if (tab.isRunning) setActiveSubTab("output");
    else if (tab.preview?.bundled && activeSubTab === "output") setActiveSubTab("preview");
    else if (tab.images?.length && activeSubTab === "output") setActiveSubTab("images");
  }, [tab.isRunning, tab.preview, tab.images]);
  
  const handleCodeChange = useCallback((code: string) => {
    setLocalCode(code);
    updateTab(tab.id, { code });
    
    // Debounced auto-save revision (save after 2 seconds of no typing)
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      saveRevision(tab.id, "Edit");
    }, 2000);
  }, [tab.id, updateTab, saveRevision]);
  
  const handleRun = useCallback(() => {
    // Save revision before running
    saveRevision(tab.id, "Before run");
    executeCode(tab.id);
  }, [tab.id, executeCode, saveRevision]);
  
  const handleUndo = useCallback(() => {
    if (canUndo(tab.id)) {
      undo(tab.id);
    }
  }, [tab.id, canUndo, undo]);
  
  const handleRedo = useCallback(() => {
    if (canRedo(tab.id)) {
      redo(tab.id);
    }
  }, [tab.id, canRedo, redo]);
  
  const handleCopy = async () => {
    await navigator.clipboard.writeText(localCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  
  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);
  
  const revisions = getRevisions(tab.id);
  
  const subTabs = [
    { id: "code" as const, label: "Code" },
    { id: "output" as const, label: "Output" },
    ...(tab.preview?.bundled ? [{ id: "preview" as const, label: "Preview" }] : []),
    ...(tab.images?.length ? [{ id: "images" as const, label: `Images (${tab.images.length})` }] : []),
    ...(revisions.length > 1 ? [{ id: "history" as const, label: `History (${revisions.length})` }] : []),
  ];
  
  return (
    <div className="flex flex-col h-full">
      {/* Sub-tab bar */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-[var(--border)] bg-[var(--bg-tertiary)]">
        {subTabs.map(st => (
          <button
            key={st.id}
            onClick={() => setActiveSubTab(st.id)}
            className={`
              px-2.5 py-1 text-xs font-medium rounded transition-colors
              ${activeSubTab === st.id 
                ? "bg-[var(--bg-tertiary)] text-white" 
                : "text-[var(--text-secondary)] hover:text-white"}
            `}
          >
            {st.label}
          </button>
        ))}
        
        <div className="flex-1" />
        
        {/* Action buttons */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-[var(--text-muted)] mr-2">{tab.language}</span>
          
          {tab.output?.durationMs !== undefined && (
            <span className="text-[10px] text-[var(--text-muted)] mr-2">{tab.output.durationMs}ms</span>
          )}
          
          {tab.output?.exitCode !== undefined && (
            <span className={`
              text-[10px] px-1.5 py-0.5 rounded mr-2
              ${tab.output.exitCode === 0 
                ? "bg-[var(--success)]/20 text-[var(--success)]" 
                : "bg-[var(--error)]/20 text-[var(--error)]"}
            `}>
              exit {tab.output.exitCode}
            </span>
          )}
          
          {/* Undo/Redo buttons */}
          <button
            onClick={handleUndo}
            disabled={!canUndo(tab.id)}
            className={`p-1.5 transition-colors ${canUndo(tab.id) ? "text-[var(--text-secondary)] hover:text-white" : "text-[var(--text-muted)] cursor-not-allowed"}`}
            title="Undo (Cmd+Z)"
          >
            <UndoIcon size={14} />
          </button>
          
          <button
            onClick={handleRedo}
            disabled={!canRedo(tab.id)}
            className={`p-1.5 transition-colors ${canRedo(tab.id) ? "text-[var(--text-secondary)] hover:text-white" : "text-[var(--text-muted)] cursor-not-allowed"}`}
            title="Redo (Cmd+Shift+Z)"
          >
            <RedoIcon size={14} />
          </button>
          
          <div className="w-px h-4 bg-[var(--bg-tertiary)] mx-1" />
          
          <button
            onClick={() => setShowMinimap(m => !m)}
            className={`p-1.5 transition-colors ${showMinimap ? "text-[var(--accent)]" : "text-[var(--text-secondary)] hover:text-white"}`}
            title={showMinimap ? "Hide minimap" : "Show minimap"}
          >
            <MapIcon size={14} />
          </button>
          
          <button
            onClick={handleCopy}
            className="p-1.5 text-[var(--text-secondary)] hover:text-white transition-colors"
            title={copied ? "Copied!" : "Copy code"}
          >
            <CopyIcon size={14} />
          </button>
          
          <button
            onClick={handleRun}
            disabled={tab.isRunning}
            className={`
              flex items-center gap-1 px-2 py-1 text-xs font-medium rounded transition-colors
              ${tab.isRunning 
                ? "bg-[var(--bg-tertiary)] text-[var(--text-secondary)] cursor-not-allowed" 
                : "bg-green-600 hover:bg-green-500 text-white"}
            `}
          >
            <PlayIcon size={12} />
            {tab.isRunning ? "Running..." : "Run"}
          </button>
        </div>
      </div>
      
      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeSubTab === "code" && (
          <MonacoEditor
            code={localCode}
            language={tab.language || "plaintext"}
            onChange={tab.isEditable ? handleCodeChange : undefined}
            onRun={handleRun}
            readOnly={!tab.isEditable}
            showMinimap={showMinimap}
          />
        )}
        
        {activeSubTab === "output" && (
          <pre
            ref={outputRef}
            className="h-full p-4 overflow-auto text-sm font-mono whitespace-pre-wrap"
          >
            {tab.isRunning && !tab.output?.stdout && !tab.output?.stderr && (
              <span className="text-[var(--text-muted)]">Running...</span>
            )}
            {tab.output?.stdout && (
              <span className="text-[var(--text-primary)]">{tab.output.stdout}</span>
            )}
            {tab.output?.stderr && (
              <span className="text-[var(--error)]">{tab.output.stderr}</span>
            )}
            {!tab.isRunning && !tab.output?.stdout && !tab.output?.stderr && (
              <span className="text-[var(--text-muted)]">No output yet. Click Run to execute.</span>
            )}
          </pre>
        )}
        
        {activeSubTab === "preview" && tab.preview?.bundled && (
          <PreviewFrame html={tab.preview.bundled} />
        )}
        
        {activeSubTab === "images" && tab.images && (
          <div className="h-full p-4 overflow-auto">
            <div className="grid grid-cols-2 gap-4">
              {tab.images.map((img, i) => (
                <div key={i} className="flex flex-col gap-2">
                  <img
                    src={`data:${img.mimeType};base64,${img.data}`}
                    alt={img.name}
                    className="w-full rounded border border-[var(--border-bright)]"
                  />
                  <span className="text-xs text-[var(--text-muted)] text-center">{img.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {activeSubTab === "history" && (
          <div className="h-full p-4 overflow-auto">
            <div className="space-y-2">
              {revisions.map((rev, idx) => {
                const isActive = idx === (tab.currentRevisionIndex ?? revisions.length - 1);
                const date = new Date(rev.timestamp);
                const timeStr = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                
                return (
                  <button
                    key={rev.id}
                    onClick={() => goToRevision(tab.id, idx)}
                    className={`
                      w-full text-left p-3 rounded-lg border transition-colors
                      ${isActive 
                        ? "bg-[var(--accent)]/20 border-[var(--accent)]/50 text-white" 
                        : "bg-[var(--bg-tertiary)] border-[var(--border-bright)] text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]/50"}
                    `}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <HistoryIcon size={14} />
                        <span className="font-medium text-sm">
                          {rev.label || `Revision ${idx + 1}`}
                        </span>
                        {isActive && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-[var(--accent)]/30 text-[var(--accent)] rounded">
                            Current
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-[var(--text-muted)]">{timeStr}</span>
                    </div>
                    <div className="mt-1 text-xs text-[var(--text-muted)]">
                      {rev.code.split("\n").length} lines, {rev.code.length} chars
                    </div>
                  </button>
                );
              })}
              
              {revisions.length === 0 && (
                <div className="text-center text-[var(--text-muted)] text-sm py-8">
                  No revisions yet. Edits are auto-saved.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PreviewFrame({ html }: { html: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [key, setKey] = useState(0);
  
  useEffect(() => {
    if (iframeRef.current) {
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      iframeRef.current.src = url;
      return () => URL.revokeObjectURL(url);
    }
  }, [html, key]);
  
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border)] bg-[var(--bg-tertiary)]">
        <button
          onClick={() => setKey(k => k + 1)}
          className="p-1 text-[var(--text-secondary)] hover:text-white transition-colors"
          title="Refresh preview"
        >
          <RefreshIcon size={14} />
        </button>
        <span className="text-xs text-[var(--text-muted)]">Live Preview</span>
      </div>
      <div className="flex-1 bg-white">
        <iframe
          ref={iframeRef}
          key={key}
          className="w-full h-full border-0"
          sandbox="allow-scripts allow-same-origin"
          title="Code Preview"
        />
      </div>
    </div>
  );
}

function ImageView({ tab }: { tab: CanvasTab }) {
  const [scale, setScale] = useState(1);
  
  if (!tab.artifact) return null;
  
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border)] bg-[var(--bg-tertiary)]">
        <button
          onClick={() => setScale(s => Math.max(0.25, s - 0.25))}
          className="px-2 py-0.5 text-xs text-[var(--text-secondary)] hover:text-white bg-[var(--bg-tertiary)] rounded"
        >
          -
        </button>
        <span className="text-xs text-[var(--text-muted)] w-12 text-center">{Math.round(scale * 100)}%</span>
        <button
          onClick={() => setScale(s => Math.min(3, s + 0.25))}
          className="px-2 py-0.5 text-xs text-[var(--text-secondary)] hover:text-white bg-[var(--bg-tertiary)] rounded"
        >
          +
        </button>
        <button
          onClick={() => setScale(1)}
          className="px-2 py-0.5 text-xs text-[var(--text-secondary)] hover:text-white bg-[var(--bg-tertiary)] rounded"
        >
          Reset
        </button>
        <div className="flex-1" />
        <a
          href={tab.artifact.url}
          download={tab.artifact.name}
          className="p-1 text-[var(--text-secondary)] hover:text-white transition-colors"
          title="Download"
        >
          <DownloadIcon size={14} />
        </a>
      </div>
      <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-[var(--bg-primary)]/50">
        <img
          src={tab.artifact.url}
          alt={tab.artifact.name}
          style={{ transform: `scale(${scale})`, transformOrigin: "center" }}
          className="max-w-full max-h-full transition-transform"
        />
      </div>
    </div>
  );
}

function AudioView({ tab }: { tab: CanvasTab }) {
  if (!tab.artifact) return null;
  
  return (
    <div className="h-full flex flex-col items-center justify-center p-8 gap-4">
      <div className="text-4xl">snd</div>
      <div className="text-sm text-[var(--text-secondary)]">{tab.artifact.name}</div>
      <audio controls src={tab.artifact.url} className="w-full max-w-md" />
      <a
        href={tab.artifact.url}
        download={tab.artifact.name}
        className="flex items-center gap-2 px-3 py-1.5 text-xs bg-[var(--bg-tertiary)] text-[var(--text-primary)] rounded hover:bg-[var(--bg-tertiary)]"
      >
        <DownloadIcon size={14} />
        Download
      </a>
    </div>
  );
}

function Model3DView({ tab }: { tab: CanvasTab }) {
  if (!tab.artifact) return null;
  
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border)] bg-[var(--bg-tertiary)]">
        <span className="text-xs text-[var(--text-muted)]">3D Model</span>
        <div className="flex-1" />
        <a
          href={tab.artifact.url}
          download={tab.artifact.name}
          className="p-1 text-[var(--text-secondary)] hover:text-white transition-colors"
          title="Download"
        >
          <DownloadIcon size={14} />
        </a>
      </div>
      <div className="flex-1 bg-[var(--bg-secondary)]">
        {/* @ts-expect-error - model-viewer is a web component */}
        <model-viewer
          src={tab.artifact.url}
          alt={tab.artifact.name}
          auto-rotate
          camera-controls
          shadow-intensity="1"
          style={{ width: "100%", height: "100%" }}
        />
      </div>
    </div>
  );
}

function ResizeHandle() {
  const { width, setWidth, setResizing } = useCanvas();
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    startXRef.current = e.clientX;
    startWidthRef.current = width;
    setResizing(true);
    
    const handleMouseMove = (e: MouseEvent) => {
      const delta = startXRef.current - e.clientX;
      setWidth(startWidthRef.current + delta);
    };
    
    const handleMouseUp = () => {
      setResizing(false);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
    
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };
  
  return (
    <div
      onMouseDown={handleMouseDown}
      className="w-1 h-full cursor-ew-resize bg-transparent hover:bg-[var(--accent)]/50 transition-colors"
    />
  );
}

export function CanvasPanel() {
  const { isOpen, tabs, width, isResizing } = useCanvas();
  const activeTab = useActiveCanvasTab();
  
  if (!isOpen || tabs.length === 0) return null;
  
  const renderContent = () => {
    if (!activeTab) return (
      <div className="h-full flex items-center justify-center text-[var(--text-muted)] text-sm">
        No content selected
      </div>
    );
    
    switch (activeTab.type) {
      case "code":
        return <CodeView tab={activeTab} />;
      case "preview":
        return <PreviewFrame html={activeTab.preview?.bundled || ""} />;
      case "image":
        return <ImageView tab={activeTab} />;
      case "audio":
        return <AudioView tab={activeTab} />;
      case "model3d":
        return <Model3DView tab={activeTab} />;
      default:
        return (
          <div className="h-full flex items-center justify-center text-[var(--text-muted)] text-sm">
            Unsupported content type
          </div>
        );
    }
  };
  
  return (
    <aside
      className="flex h-full bg-[var(--bg-secondary)] border-l border-[var(--border)]"
      style={{ 
        width: width,
        minWidth: width,
        transition: isResizing ? "none" : "width 0.2s ease",
      }}
    >
      <ResizeHandle />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TabBar />
        <div className="flex-1 overflow-hidden">
          {renderContent()}
        </div>
      </div>
    </aside>
  );
}

export default CanvasPanel;
