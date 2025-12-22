"use client";

import { WidgetContainer, NewsIcon } from "./WidgetContainer";
import type { NewsData } from "@/lib/widgets/types";

interface NewsWidgetProps {
  data?: NewsData;
  isLoading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
}

export function NewsWidget({ data, isLoading, error, onRefresh }: NewsWidgetProps) {
  const badge = data ? `${data.items.length}` : undefined;

  return (
    <WidgetContainer
      title="News"
      icon={<NewsIcon />}
      badge={badge}
      isLoading={isLoading}
      error={error}
      onRefresh={onRefresh}
      lastUpdated={data?.updatedAt}
      defaultExpanded={false}
    >
      {data && (
        <div className="news-content">
          {data.items.slice(0, 5).map((item) => (
            <a
              key={item.id}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="news-item"
            >
              <div className="news-item-header">
                <span className="news-source">{item.source}</span>
                {item.time && <span className="news-time">{item.time}</span>}
              </div>
              <div className="news-title">{item.title}</div>
            </a>
          ))}
        </div>
      )}
    </WidgetContainer>
  );
}
