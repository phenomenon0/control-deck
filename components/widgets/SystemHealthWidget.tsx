"use client";

import { Cpu } from "lucide-react";
import { WidgetContainer } from "@/components/widgets/WidgetContainer";
import { useSystemStats } from "@/lib/hooks/useSystemStats";

export function SystemHealthWidget() {
  const { stats, refresh } = useSystemStats();

  const gpu = stats?.gpu ?? null;

  const bars = [
    {
      label: "GPU",
      percent: gpu ? gpu.utilization : null,
      real: true,
    },
    {
      label: "CPU",
      percent: 34,
      real: false,
    },
    {
      label: "RAM",
      percent: 58,
      real: false,
    },
    {
      label: "Disk",
      percent: 71,
      real: false,
    },
  ];

  const badge = gpu ? `${gpu.temperature}°C` : undefined;

  return (
    <WidgetContainer
      title="System Health"
      icon={<Cpu size={14} />}
      badge={badge}
      defaultExpanded={true}
      onRefresh={refresh}
    >
      {!gpu ? (
        <div
          style={{
            color: "var(--text-muted)",
            fontSize: "12px",
            padding: "8px 0",
            textAlign: "center",
          }}
        >
          Waiting for data...
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {bars.map((bar) => (
            <div key={bar.label}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: "4px",
                  fontSize: "12px",
                }}
              >
                <span style={{ color: "var(--text-primary)" }}>{bar.label}</span>
                <span style={{ color: "var(--text-muted)" }}>
                  {bar.percent !== null ? `${bar.percent}%` : "—"}
                </span>
              </div>
              <div
                style={{
                  height: "6px",
                  borderRadius: "3px",
                  background: "var(--bg-tertiary)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${bar.percent ?? 0}%`,
                    borderRadius: "3px",
                    background: "var(--accent)",
                    transition: "width 0.4s ease",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </WidgetContainer>
  );
}
