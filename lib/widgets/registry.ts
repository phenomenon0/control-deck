export interface WidgetMeta {
  id: string;
  name: string;
  description: string;
  defaultSize: "1x1" | "2x1" | "2x2" | "1x2" | "3x1" | "full";
  minSize: "1x1" | "2x1";
  category: "system" | "data" | "actions" | "info";
}

// Registry of ALL widgets
export const WIDGET_REGISTRY: WidgetMeta[] = [
  { id: "system-health", name: "System Health", description: "CPU, GPU, RAM, Disk gauges", defaultSize: "2x1", minSize: "1x1", category: "system" },
  { id: "vram", name: "VRAM", description: "GPU memory allocation breakdown", defaultSize: "2x1", minSize: "1x1", category: "system" },
  { id: "services", name: "Services", description: "Service health status", defaultSize: "1x1", minSize: "1x1", category: "system" },
  { id: "model-fleet", name: "Model Fleet", description: "Loaded models and status", defaultSize: "2x1", minSize: "1x1", category: "system" },
  { id: "quick-actions", name: "Quick Actions", description: "Launch common tasks", defaultSize: "2x1", minSize: "1x1", category: "actions" },
  { id: "recent-activity", name: "Recent Activity", description: "Latest events and messages", defaultSize: "2x2", minSize: "2x1", category: "info" },
  { id: "todo", name: "Todo", description: "Task list", defaultSize: "1x1", minSize: "1x1", category: "data" },
  { id: "stats", name: "Session Stats", description: "Messages, tokens, tool calls", defaultSize: "1x1", minSize: "1x1", category: "data" },
  { id: "weather", name: "Weather", description: "Current weather and forecast", defaultSize: "1x1", minSize: "1x1", category: "info" },
  { id: "news", name: "News", description: "Tech news feed", defaultSize: "1x1", minSize: "1x1", category: "info" },
  { id: "sports", name: "Sports", description: "Live scores", defaultSize: "1x1", minSize: "1x1", category: "info" },
  { id: "stocks", name: "Stocks", description: "Stock quotes", defaultSize: "1x1", minSize: "1x1", category: "info" },
  { id: "live", name: "Live", description: "Music transport (BPM + play/stop)", defaultSize: "1x1", minSize: "1x1", category: "actions" },
];

export function getWidgetMeta(id: string): WidgetMeta | undefined {
  return WIDGET_REGISTRY.find(w => w.id === id);
}
