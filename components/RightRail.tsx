"use client";

import { useState } from "react";
import { useRightRailData } from "@/lib/hooks/useRightRail";
import { ChevronLeft, ChevronRight, Cpu, Wrench, FileText, Plus } from "lucide-react";
import { useDeckSettings } from "@/components/settings/DeckSettingsProvider";
import { useSystemStats } from "@/lib/hooks/useSystemStats";
import { useModels } from "@/lib/hooks/useModels";
import type { ToolCallData } from "@/components/chat/ToolCallCard";
import type { Artifact } from "@/components/chat/ArtifactRenderer";
import { ToolResultCard } from "@/components/sidebar/ToolResultCard";
import { useWidgets } from "@/lib/hooks/useWidgets";
import { 
  WeatherWidget, 
  NewsWidget, 
  SportsWidget,
  StocksWidget,
  TodoWidget,
  WidgetDock
} from "@/components/widgets";
import { PluginMaker } from "@/components/plugins";
import type { PluginBundle } from "@/lib/plugins/types";

// =============================================================================
// Helpers
// =============================================================================

/**
 * Format model name for display - extracts friendly name from full paths
 */
function formatModelName(model: string): string {
  if (model.includes("/") || model.includes("\\")) {
    const parts = model.split(/[/\\]/);
    const filename = parts[parts.length - 1];
    return filename.replace(/\.gguf$/i, "");
  }
  return model;
}

// =============================================================================
// RightRail Component - Informative Sidebar with Collapsible Widgets
// =============================================================================

export function RightRail() {
  const { threadId, model, isLoading, toolCalls, artifacts, onSendMessage } = useRightRailData();
  const { railOpen, setRailOpen, prefs, updatePrefs } = useDeckSettings();
  const { stats: systemStats } = useSystemStats();
  const { models } = useModels();
  const [expandedArtifact, setExpandedArtifact] = useState<Artifact | null>(null);
  const [showPluginMaker, setShowPluginMaker] = useState(false);
  
  // Widgets data
  const widgets = useWidgets();
  
  // Plugin Maker handlers
  const handleSavePlugin = async (bundle: PluginBundle) => {
    const res = await fetch("/api/plugins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bundle }),
    });
    
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Failed to save plugin");
    }
    
    setShowPluginMaker(false);
    // TODO: Refresh plugins list or show success toast
  };

  const onlineServices = systemStats?.services.filter(s => s.status === "online").length ?? 0;
  const totalServices = systemStats?.services.length ?? 0;

  // Collapsed mini bar
  if (!railOpen) {
    return (
      <aside className="right-rail collapsed">
        <button className="rail-expand-btn" onClick={() => setRailOpen(true)} title="Expand sidebar">
          <ChevronLeftIcon />
        </button>
        
        <div className="rail-mini-status">
          {isLoading && <div className="mini-dot loading" title="Running..." />}
          {systemStats?.gpu && (
            <div className="mini-gpu" title={`GPU: ${systemStats.gpu.memoryPercent}% | ${systemStats.gpu.temperature}°C`}>
              {systemStats.gpu.memoryPercent}%
            </div>
          )}
          <div className="mini-services" title={`${onlineServices}/${totalServices} services`}>
            <span className={onlineServices === totalServices ? "online" : "partial"}>●</span>
          </div>
          {artifacts.length > 0 && (
            <div className="mini-artifacts" title={`${artifacts.length} files`}>
              {artifacts.length}
            </div>
          )}
        </div>
      </aside>
    );
  }

  return (
    <aside className="right-rail expanded">
      {/* ===== HEADER: Status + Model ===== */}
      <div className="sidebar-header">
        <div className="header-left">
          <span className={`status-dot ${isLoading ? "running" : "idle"}`} />
          <select
            className="model-select"
            value={prefs.model}
            onChange={(e) => updatePrefs({ model: e.target.value })}
            title="Select model"
          >
            {/* Always show current model, even if not in list */}
            {!models.includes(prefs.model) && prefs.model && (
              <option value={prefs.model}>{formatModelName(prefs.model)}</option>
            )}
            {models.map((m) => (
              <option key={m} value={m}>{formatModelName(m)}</option>
            ))}
            {models.length === 0 && !prefs.model && (
              <option value="">Loading...</option>
            )}
          </select>
        </div>
        <button className="rail-close" onClick={() => setRailOpen(false)} title="Collapse">
          <ChevronRightIcon />
        </button>
      </div>

      {/* ===== MAIN CONTENT ===== */}
      <div className="sidebar-content">
        
        {/* GPU Bar - Always visible, compact */}
        {systemStats?.gpu && (
          <div className="gpu-compact">
            <div className="gpu-header">
              <span className="gpu-label">
                <GpuIcon /> GPU
              </span>
              <span className="gpu-temp">{systemStats.gpu.temperature}°C</span>
            </div>
            <div className="gpu-bar-compact">
              <div 
                className="gpu-bar-fill" 
                style={{ width: `${systemStats.gpu.memoryPercent}%` }} 
              />
            </div>
            <div className="gpu-stats">
              <span>{systemStats.gpu.memoryUsed}MB / {systemStats.gpu.memoryTotal}MB</span>
              <span>{systemStats.gpu.utilization}% util</span>
            </div>
          </div>
        )}

        {/* Tool Calls - Only show when active */}
        {toolCalls.length > 0 && (
          <section className="sidebar-section">
            <h4 className="section-title">
              <ToolIcon /> Tools
              <span className="count-badge">{toolCalls.length}</span>
            </h4>
            <div className="tool-calls-list">
              {toolCalls.slice(-4).reverse().map((tc) => (
                tc.status === "complete" && tc.result ? (
                  <ToolResultCard key={tc.id} tool={tc} />
                ) : (
                  <ToolCallRow key={tc.id} tool={tc} />
                )
              ))}
            </div>
          </section>
        )}

        {/* Artifacts - Only show when present */}
        {artifacts.length > 0 && (
          <section className="sidebar-section">
            <h4 className="section-title">
              <FileIcon /> Files
              <span className="count-badge">{artifacts.length}</span>
            </h4>
            <div className="artifacts-grid">
              {artifacts.slice(-6).map((a, i) => (
                <ArtifactThumb 
                  key={i} 
                  artifact={a} 
                  onClick={() => setExpandedArtifact(a)} 
                />
              ))}
            </div>
          </section>
        )}

        {/* ===== WIDGETS SECTION - Draggable ===== */}
        <div className="widgets-section">
          <div className="widgets-header">
            <span className="widgets-title">Widgets</span>
            <button 
              className="add-plugin-btn" 
              onClick={() => setShowPluginMaker(true)}
              title="Create new plugin"
            >
              <PlusIcon />
            </button>
          </div>
          <WidgetDock 
            widgetIds={["todo", "sports", "weather", "news", "stocks"]}
            storageKey="deck:widget-order"
          >
            {/* Todo - Priority 1, always expanded */}
            <TodoWidget 
              data={widgets.data.todo}
              onUpdate={widgets.updateTodo}
            />
            
            {/* Sports - Priority 2 (Arsenal scores) */}
            <SportsWidget
              data={widgets.data.sports}
              isLoading={widgets.loading.sports}
              error={widgets.errors.sports}
              onRefresh={() => widgets.refresh("sports")}
            />
            
            {/* Weather - Priority 3 */}
            <WeatherWidget
              data={widgets.data.weather}
              isLoading={widgets.loading.weather}
              error={widgets.errors.weather}
              onRefresh={() => widgets.refresh("weather")}
            />
            
            {/* News - Priority 4 (Arsenal + AI/Tech) */}
            <NewsWidget
              data={widgets.data.news}
              isLoading={widgets.loading.news}
              error={widgets.errors.news}
              onRefresh={() => widgets.refresh("news")}
            />
            
            {/* Stocks - Priority 5 */}
            <StocksWidget
              data={widgets.data.stocks}
              isLoading={widgets.loading.stocks}
              error={widgets.errors.stocks}
              onRefresh={() => widgets.refresh("stocks")}
            />
          </WidgetDock>
        </div>
      </div>

      {/* ===== FOOTER: Theme ===== */}
      <div className="sidebar-footer">
        {/* Theme selector — light / dark / system */}
        <div className="theme-row">
          <span className="theme-label">theme</span>
          {(["light", "dark", "system"] as const).map((t) => (
            <button
              key={t}
              className={`theme-btn ${prefs.theme === t ? "active" : ""}`}
              onClick={() => updatePrefs({ theme: t })}
              title={t.charAt(0).toUpperCase() + t.slice(1)}
              style={{
                borderColor: "var(--accent)",
                color: "var(--accent)",
              }}
            />
          ))}
        </div>
      </div>

      {/* Artifact Modal */}
      {expandedArtifact && (
        <ArtifactModal 
          artifact={expandedArtifact} 
          onClose={() => setExpandedArtifact(null)} 
        />
      )}
      
      {/* Plugin Maker Modal */}
      {showPluginMaker && (
        <div className="modal-overlay" onClick={() => setShowPluginMaker(false)}>
          <div className="modal-content modal-lg" onClick={(e) => e.stopPropagation()}>
            <PluginMaker
              onSave={handleSavePlugin}
              onCancel={() => setShowPluginMaker(false)}
            />
          </div>
        </div>
      )}
    </aside>
  );
}

// =============================================================================
// Sub-components
// =============================================================================

function ToolCallRow({ tool }: { tool: ToolCallData }) {
  const statusColor = tool.status === "complete" ? "success" : tool.status === "error" ? "error" : "running";
  const duration = tool.durationMs 
    ? (tool.durationMs > 1000 ? `${(tool.durationMs / 1000).toFixed(1)}s` : `${tool.durationMs}ms`) 
    : null;
  
  return (
    <div className={`tool-call-row ${statusColor}`}>
      <span className="tool-status-dot" />
      <span className="tool-name">{tool.name.replace(/_/g, " ")}</span>
      {duration && <span className="tool-duration">{duration}</span>}
      {tool.status === "running" && <span className="tool-spinner" />}
    </div>
  );
}

function ArtifactThumb({ artifact, onClick }: { artifact: Artifact; onClick: () => void }) {
  const isImage = artifact.mimeType?.startsWith("image/");
  const isAudio = artifact.mimeType?.startsWith("audio/");
  
  return (
    <button className="artifact-thumb" onClick={onClick} title={artifact.name}>
      {isImage ? (
        <img src={artifact.url} alt={artifact.name} />
      ) : isAudio ? (
        <span className="artifact-icon">🎵</span>
      ) : (
        <span className="artifact-icon">📄</span>
      )}
    </button>
  );
}

function ArtifactModal({ artifact, onClose }: { artifact: Artifact; onClose: () => void }) {
  const isImage = artifact.mimeType?.startsWith("image/");
  const isAudio = artifact.mimeType?.startsWith("audio/");
  
  return (
    <div className="artifact-modal-overlay" onClick={onClose}>
      <div className="artifact-modal" onClick={(e) => e.stopPropagation()}>
        <div className="artifact-modal-header">
          <span>{artifact.name}</span>
          <button onClick={onClose}>×</button>
        </div>
        <div className="artifact-modal-content">
          {isImage && <img src={artifact.url} alt={artifact.name} />}
          {isAudio && <audio src={artifact.url} controls />}
          {!isImage && !isAudio && (
            <div className="artifact-download">
              <a href={artifact.url} download={artifact.name}>Download {artifact.name}</a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Icons — provided by lucide-react (imported at top of file)
// =============================================================================

function ChevronLeftIcon() {
  return <ChevronLeft width={16} height={16} />;
}

function ChevronRightIcon() {
  return <ChevronRight width={14} height={14} />;
}

function GpuIcon() {
  return <Cpu width={12} height={12} />;
}

function ToolIcon() {
  return <Wrench width={12} height={12} />;
}

function FileIcon() {
  return <FileText width={12} height={12} />;
}

function PlusIcon() {
  return <Plus width={14} height={14} />;
}
