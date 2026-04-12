"use client";

import { useState, useEffect, ReactNode } from "react";

// =============================================================================
// Types
// =============================================================================

interface WidgetDockProps {
  children: ReactNode[];
  widgetIds: string[];
  storageKey?: string;
}

// =============================================================================
// WidgetDock - Simple widget container with persisted order
// =============================================================================

export function WidgetDock({ 
  children, 
  widgetIds,
  storageKey = "deck:widget-order" 
}: WidgetDockProps) {
  const [order, setOrder] = useState<string[]>(widgetIds);

  // Load order from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const savedOrder = JSON.parse(stored) as string[];
        // Merge with current widgetIds (handle new/removed widgets)
        const validOrder = savedOrder.filter(id => widgetIds.includes(id));
        const newWidgets = widgetIds.filter(id => !savedOrder.includes(id));
        setOrder([...validOrder, ...newWidgets]);
      }
    } catch {
      // Use default order
    }
  }, [widgetIds, storageKey]);

  // Create widget map from children
  const widgetMap = new Map<string, ReactNode>();
  children.forEach((child, i) => {
    if (widgetIds[i]) {
      widgetMap.set(widgetIds[i], child);
    }
  });

  // Render widgets in saved order
  return (
    <div className="widget-dock">
      {order.map((id) => {
        const widget = widgetMap.get(id);
        if (!widget) return null;

        return (
          <div key={id} className="widget-slot">
            {widget}
          </div>
        );
      })}
    </div>
  );
}
