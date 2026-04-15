"use client";

import { useDashboardLayout } from "@/lib/hooks/useDashboardLayout";
import { useWidgets } from "@/lib/hooks/useWidgets";
import { useSystemStats } from "@/lib/hooks/useSystemStats";
import { DashboardGrid } from "@/components/deck/DashboardGrid";
import {
  SystemHealthWidget,
  VRAMWidget,
  ServiceStatusWidget,
  ModelFleetWidget,
  QuickActionsWidget,
  RecentActivityWidget,
  TodoWidget,
  StatsWidget,
  WeatherWidget,
  NewsWidget,
  SportsWidget,
  StocksWidget,
  LiveTransportWidget,
} from "@/components/widgets";

export default function DeckPage() {
  const layout = useDashboardLayout();
  const widgets = useWidgets();

  // Map widget IDs to their rendered components
  function renderWidget(widgetId: string) {
    switch (widgetId) {
      case "system-health":
        return <SystemHealthWidget />;
      case "vram":
        return <VRAMWidget />;
      case "services":
        return <ServiceStatusWidget />;
      case "model-fleet":
        return <ModelFleetWidget />;
      case "quick-actions":
        return <QuickActionsWidget />;
      case "recent-activity":
        return <RecentActivityWidget />;
      case "todo":
        return <TodoWidget data={widgets.data.todo} onUpdate={widgets.updateTodo} />;
      case "stats":
        return <StatsWidget data={widgets.data.stats} />;
      case "weather":
        return (
          <WeatherWidget
            data={widgets.data.weather}
            isLoading={widgets.loading.weather}
            error={widgets.errors.weather}
            onRefresh={() => widgets.refresh("weather")}
          />
        );
      case "news":
        return (
          <NewsWidget
            data={widgets.data.news}
            isLoading={widgets.loading.news}
            error={widgets.errors.news}
            onRefresh={() => widgets.refresh("news")}
          />
        );
      case "sports":
        return (
          <SportsWidget
            data={widgets.data.sports}
            isLoading={widgets.loading.sports}
            error={widgets.errors.sports}
            onRefresh={() => widgets.refresh("sports")}
          />
        );
      case "stocks":
        return (
          <StocksWidget
            data={widgets.data.stocks}
            isLoading={widgets.loading.stocks}
            error={widgets.errors.stocks}
            onRefresh={() => widgets.refresh("stocks")}
          />
        );
      case "live":
        return <LiveTransportWidget />;
      default:
        return <div style={{ padding: 16, color: "var(--text-muted)" }}>Unknown widget: {widgetId}</div>;
    }
  }

  return (
    <div className="deck-page">
      <DashboardGrid
        items={layout.items}
        availableWidgets={layout.availableWidgets}
        onReorder={layout.reorder}
        onAdd={layout.addWidget}
        onRemove={layout.removeWidget}
        renderWidget={renderWidget}
      />
    </div>
  );
}
