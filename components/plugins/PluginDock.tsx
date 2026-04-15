"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { GripVertical, LayoutDashboard } from "lucide-react";
import type { PluginInstance } from "@/lib/plugins/types";
import { PluginHost } from "./PluginHost";

interface PluginDockProps {
  plugins: PluginInstance[];
  onReorder?: (orderedIds: string[]) => void;
  onPluginSettings?: (plugin: PluginInstance) => void;
  onPluginRemove?: (plugin: PluginInstance) => void;
  storageKey?: string;
  compact?: boolean;
}

interface DragState {
  dragging: string | null;
  dragOver: string | null;
  dragY: number;
}

/**
 * PluginDock - Composable container for plugin widgets with drag/drop reordering
 * 
 * Features:
 * - Drag and drop reordering
 * - Persistent order via localStorage
 * - Compact/expanded modes
 * - Add plugin button
 */
export function PluginDock({
  plugins,
  onReorder,
  onPluginSettings,
  onPluginRemove,
  storageKey = "deck:plugin-order",
  compact = false,
}: PluginDockProps) {
  // Filter to only enabled plugins
  const enabledPlugins = plugins.filter(p => p.enabled);
  
  const [order, setOrder] = useState<string[]>(() => enabledPlugins.map(p => p.id));
  const [dragState, setDragState] = useState<DragState>({
    dragging: null,
    dragOver: null,
    dragY: 0,
  });
  const containerRef = useRef<HTMLDivElement>(null);

  // Load order from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const savedOrder = JSON.parse(stored) as string[];
        const pluginIds = new Set(enabledPlugins.map(p => p.id));
        
        // Merge with current plugins (handle new/removed plugins)
        const validOrder = savedOrder.filter(id => pluginIds.has(id));
        const newPlugins = enabledPlugins
          .filter(p => !savedOrder.includes(p.id))
          .map(p => p.id);
        
        setOrder([...validOrder, ...newPlugins]);
      } else {
        setOrder(enabledPlugins.map(p => p.id));
      }
    } catch {
      setOrder(enabledPlugins.map(p => p.id));
    }
  }, [enabledPlugins, storageKey]);

  // Save order to localStorage and notify parent
  const saveOrder = useCallback((newOrder: string[]) => {
    setOrder(newOrder);
    try {
      localStorage.setItem(storageKey, JSON.stringify(newOrder));
    } catch {
      // Ignore
    }
    onReorder?.(newOrder);
  }, [storageKey, onReorder]);

  // Drag handlers
  const handleDragStart = useCallback((id: string, e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
    
    // Create ghost image
    const ghost = document.createElement("div");
    ghost.className = "plugin-drag-ghost";
    ghost.textContent = "Moving plugin...";
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 0, 0);
    setTimeout(() => ghost.remove(), 0);

    setDragState(prev => ({ ...prev, dragging: id }));
  }, []);

  const handleDragOver = useCallback((id: string, e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragState(prev => ({ ...prev, dragOver: id, dragY: e.clientY }));
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragState(prev => ({ ...prev, dragOver: null }));
  }, []);

  const handleDrop = useCallback((targetId: string, e: React.DragEvent) => {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData("text/plain");
    
    if (sourceId && sourceId !== targetId) {
      const newOrder = [...order];
      const sourceIdx = newOrder.indexOf(sourceId);
      const targetIdx = newOrder.indexOf(targetId);
      
      if (sourceIdx !== -1 && targetIdx !== -1) {
        // Remove from old position
        newOrder.splice(sourceIdx, 1);
        // Insert at new position
        newOrder.splice(targetIdx, 0, sourceId);
        saveOrder(newOrder);
      }
    }
    
    setDragState({ dragging: null, dragOver: null, dragY: 0 });
  }, [order, saveOrder]);

  const handleDragEnd = useCallback(() => {
    setDragState({ dragging: null, dragOver: null, dragY: 0 });
  }, []);

  // Create plugin map
  const pluginMap = new Map(enabledPlugins.map(p => [p.id, p]));

  // No plugins
  if (enabledPlugins.length === 0) {
    return (
      <div className="plugin-dock plugin-dock-empty">
        <EmptyPluginsIcon />
        <span className="plugin-dock-empty-text">No plugins enabled</span>
        <span className="plugin-dock-empty-hint">Add plugins to customize your dashboard</span>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={`plugin-dock ${compact ? "plugin-dock-compact" : ""}`}>
      {order.map((id) => {
        const plugin = pluginMap.get(id);
        if (!plugin) return null;

        const isDragging = dragState.dragging === id;
        const isDragOver = dragState.dragOver === id;

        return (
          <div
            key={id}
            className={`plugin-slot ${isDragging ? "dragging" : ""} ${isDragOver ? "drag-over" : ""}`}
            draggable
            onDragStart={(e) => handleDragStart(id, e)}
            onDragOver={(e) => handleDragOver(id, e)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(id, e)}
            onDragEnd={handleDragEnd}
          >
            <div className="plugin-drag-handle" title="Drag to reorder">
              <DragHandleIcon />
            </div>
            <div className="plugin-slot-content">
              <PluginHost
                plugin={plugin}
                onSettingsClick={onPluginSettings ? () => onPluginSettings(plugin) : undefined}
                onRemove={onPluginRemove ? () => onPluginRemove(plugin) : undefined}
                compact={compact}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DragHandleIcon() {
  return <GripVertical width={10} height={10} />;
}

function EmptyPluginsIcon() {
  return <LayoutDashboard width={32} height={32} strokeWidth={1.5} opacity={0.4} />;
}
