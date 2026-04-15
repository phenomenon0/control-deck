"use client";
import { useState, useCallback, useEffect } from "react";
import { WIDGET_REGISTRY, type WidgetMeta } from "@/lib/widgets/registry";

const STORAGE_KEY = "deck:dashboard-layout";

export interface DashboardItem {
  id: string;       // widget id from registry
  size: "1x1" | "2x1" | "2x2" | "1x2" | "3x1" | "full";
}

// Default layout for first-time users
const DEFAULT_LAYOUT: DashboardItem[] = [
  { id: "system-health", size: "2x1" },
  { id: "vram", size: "2x1" },
  { id: "services", size: "1x1" },
  { id: "model-fleet", size: "2x1" },
  { id: "quick-actions", size: "2x1" },
  { id: "recent-activity", size: "2x2" },
  { id: "todo", size: "1x1" },
  { id: "stats", size: "1x1" },
  { id: "weather", size: "1x1" },
  { id: "news", size: "1x1" },
];

function saveLayout(items: DashboardItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch (err) {
    console.warn("[useDashboardLayout] Failed to save layout:", err);
  }
}

export function useDashboardLayout() {
  const [items, setItems] = useState<DashboardItem[]>(DEFAULT_LAYOUT);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as DashboardItem[];
        const valid = parsed.filter(item => WIDGET_REGISTRY.some(w => w.id === item.id));
        if (valid.length > 0) setItems(valid);
      }
    } catch (err) {
      console.warn("[useDashboardLayout] Corrupted layout, using defaults:", err);
    }
  }, []);

  const persist = useCallback((newItems: DashboardItem[]) => {
    setItems(newItems);
    saveLayout(newItems);
  }, []);

  const reorder = useCallback((fromIndex: number, toIndex: number) => {
    setItems(prev => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      saveLayout(next);
      return next;
    });
  }, []);

  const addWidget = useCallback((id: string) => {
    const meta = WIDGET_REGISTRY.find(w => w.id === id);
    if (!meta) return;
    setItems(prev => {
      if (prev.some(item => item.id === id)) return prev;
      const next = [...prev, { id, size: meta.defaultSize }];
      saveLayout(next);
      return next;
    });
  }, []);

  const removeWidget = useCallback((id: string) => {
    setItems(prev => {
      const next = prev.filter(item => item.id !== id);
      saveLayout(next);
      return next;
    });
  }, []);

  const resizeWidget = useCallback((id: string, size: DashboardItem["size"]) => {
    setItems(prev => {
      const next = prev.map(item => item.id === id ? { ...item, size } : item);
      saveLayout(next);
      return next;
    });
  }, []);

  // Reset to defaults
  const resetLayout = useCallback(() => {
    persist(DEFAULT_LAYOUT);
  }, [persist]);

  // Available widgets not currently in layout
  const availableWidgets = WIDGET_REGISTRY.filter(w => !items.some(item => item.id === w.id));

  return { items, reorder, addWidget, removeWidget, resizeWidget, resetLayout, availableWidgets };
}
