"use client";

import { WidgetContainer, StatsIcon } from "./WidgetContainer";
import type { StatsData } from "@/lib/widgets/types";

interface StatsWidgetProps {
  data?: StatsData;
}

export function StatsWidget({ data }: StatsWidgetProps) {
  const badge = data ? `${formatTokens(data.tokensEstimate)} tokens` : undefined;

  return (
    <WidgetContainer
      title="Session"
      icon={<StatsIcon />}
      badge={badge}
      defaultExpanded={false}
    >
      {data && (
        <div className="stats-content">
          <div className="stats-row">
            <span className="stats-label">Session</span>
            <span className="stats-value">{formatDuration(data.sessionStart)}</span>
          </div>
          <div className="stats-row">
            <span className="stats-label">Messages</span>
            <span className="stats-value">{data.messagesCount}</span>
          </div>
          <div className="stats-row">
            <span className="stats-label">Tokens (est.)</span>
            <span className="stats-value">{formatTokens(data.tokensEstimate)}</span>
          </div>
          <div className="stats-row">
            <span className="stats-label">Tool Calls</span>
            <span className="stats-value">{data.toolCalls}</span>
          </div>
          <div className="stats-row">
            <span className="stats-label">Images</span>
            <span className="stats-value">{data.imagesGenerated}</span>
          </div>
        </div>
      )}
    </WidgetContainer>
  );
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return tokens.toString();
}

function formatDuration(startIso: string): string {
  const start = new Date(startIso);
  const diff = Date.now() - start.getTime();
  const mins = Math.floor(diff / 60000);
  
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hours}h ${remainMins}m`;
}
