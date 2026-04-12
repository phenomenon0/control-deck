"use client";

import { Radio } from "lucide-react";
import { WidgetContainer } from "@/components/widgets/WidgetContainer";
import { useSystemStats } from "@/lib/hooks/useSystemStats";

const STATUS_COLORS: Record<string, string> = {
  online: "#56b6c2",
  offline: "#e06c75",
  unknown: "var(--text-muted)",
};

export function ServiceStatusWidget() {
  const { stats, refresh } = useSystemStats();

  const services = stats?.services ?? [];

  const onlineCount = services.filter((s) => s.status === "online").length;
  const badge =
    services.length > 0 ? `${onlineCount}/${services.length} online` : undefined;

  return (
    <WidgetContainer
      title="Service Status"
      icon={<Radio size={14} />}
      badge={badge}
      defaultExpanded={true}
      onRefresh={refresh}
    >
      {services.length === 0 ? (
        <div
          style={{
            color: "var(--text-muted)",
            fontSize: "12px",
            padding: "8px 0",
            textAlign: "center",
          }}
        >
          No services configured
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {services.map((service) => (
            <div
              key={service.url}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                fontSize: "12px",
              }}
            >
              <div
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  flexShrink: 0,
                  background: STATUS_COLORS[service.status] ?? "var(--text-muted)",
                }}
              />
              <span
                style={{
                  color: "var(--text-primary)",
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {service.name}
              </span>
              {service.latencyMs !== undefined && (
                <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>
                  {service.latencyMs}ms
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </WidgetContainer>
  );
}
