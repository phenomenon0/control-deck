"use client";

import { useState } from "react";
import {
  Activity,
  MessageSquare,
  Wrench,
  ImageIcon,
  Mic,
  Bot,
  Brain,
} from "lucide-react";
import { WidgetContainer } from "@/components/widgets/WidgetContainer";

interface ActivityEvent {
  id: string;
  type: "chat" | "tool" | "image" | "voice" | "agent" | "model";
  message: string;
  timestamp: string;
}

interface RecentActivityWidgetProps {
  events?: ActivityEvent[];
}

const TYPE_ICONS: Record<ActivityEvent["type"], React.ReactNode> = {
  chat: <MessageSquare size={12} />,
  tool: <Wrench size={12} />,
  image: <ImageIcon size={12} />,
  voice: <Mic size={12} />,
  agent: <Bot size={12} />,
  model: <Brain size={12} />,
};

const DEMO_EVENTS: ActivityEvent[] = [
  {
    id: "demo-1",
    type: "chat",
    message: "Started conversation with llama-3.3-70b",
    timestamp: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
  },
  {
    id: "demo-2",
    type: "image",
    message: "Generated image via ComfyUI",
    timestamp: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
  },
  {
    id: "demo-3",
    type: "tool",
    message: "Ran web_search tool",
    timestamp: new Date(Date.now() - 34 * 60 * 1000).toISOString(),
  },
  {
    id: "demo-4",
    type: "model",
    message: "Loaded mistral-7b-instruct.gguf",
    timestamp: new Date(Date.now() - 72 * 60 * 1000).toISOString(),
  },
];

function relativeTime(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function RecentActivityWidget({ events }: RecentActivityWidgetProps) {
  const [_localEvents] = useState<ActivityEvent[]>(DEMO_EVENTS);
  const displayEvents = events ?? _localEvents;

  return (
    <WidgetContainer
      title="Recent Activity"
      icon={<Activity size={14} />}
      badge={displayEvents.length}
      defaultExpanded={true}
    >
      {displayEvents.length === 0 ? (
        <div
          style={{
            color: "var(--text-muted)",
            fontSize: "12px",
            padding: "8px 0",
            textAlign: "center",
          }}
        >
          No recent activity
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {displayEvents.map((event) => (
            <div
              key={event.id}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "8px",
                fontSize: "12px",
              }}
            >
              <span
                style={{
                  color: "var(--accent)",
                  flexShrink: 0,
                  marginTop: "1px",
                  opacity: 0.85,
                }}
              >
                {TYPE_ICONS[event.type]}
              </span>
              <span
                style={{
                  color: "var(--text-primary)",
                  flex: 1,
                  lineHeight: "1.4",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {event.message}
              </span>
              <span
                style={{
                  color: "var(--text-muted)",
                  flexShrink: 0,
                  fontSize: "11px",
                  marginTop: "1px",
                }}
              >
                {relativeTime(event.timestamp)}
              </span>
            </div>
          ))}
        </div>
      )}
    </WidgetContainer>
  );
}
