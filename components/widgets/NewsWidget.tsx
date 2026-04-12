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
  const count = data?.items.length;
  const badge = count ? `${count}` : undefined;

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
        <div className="news-content-compact">
          {data.items.slice(0, 4).map((item, index) => (
            <a
              key={`${item.id}-${index}`}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="news-item-compact"
              title={item.title}
            >
              {item.title}
            </a>
          ))}
        </div>
      )}
    </WidgetContainer>
  );
}
