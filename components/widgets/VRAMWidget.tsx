"use client";

import { HardDrive } from "lucide-react";
import { WidgetContainer } from "@/components/widgets/WidgetContainer";
import { useSystemStats } from "@/lib/hooks/useSystemStats";
import { useModels } from "@/lib/hooks/useModels";

const DOT_COLORS = [
  "#7c6af7",
  "#4fa3e0",
  "#e06c75",
  "#56b6c2",
  "#e5c07b",
  "#98c379",
];

export function VRAMWidget() {
  const { stats, refresh } = useSystemStats();
  const { models } = useModels();

  const gpu = stats?.gpu ?? null;

  const usedGB = gpu ? (gpu.memoryUsed / 1024).toFixed(1) : null;
  const totalGB = gpu ? (gpu.memoryTotal / 1024).toFixed(1) : null;
  const badge =
    usedGB && totalGB ? `${usedGB}/${totalGB} GB` : undefined;

  return (
    <WidgetContainer
      title="VRAM"
      icon={<HardDrive size={14} />}
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
          No GPU detected
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div
            style={{
              height: "14px",
              borderRadius: "7px",
              background: "var(--bg-tertiary)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${gpu.memoryPercent}%`,
                borderRadius: "7px",
                background: "var(--accent)",
                transition: "width 0.4s ease",
              }}
            />
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "12px",
              color: "var(--text-muted)",
            }}
          >
            <span>
              {usedGB} GB / {totalGB} GB
            </span>
            <span>{gpu.memoryPercent}%</span>
          </div>

          {models.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <div
                style={{
                  fontSize: "11px",
                  color: "var(--text-muted)",
                  marginBottom: "2px",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Loaded Models
              </div>
              {models.map((model, i) => (
                <div
                  key={model}
                  style={{ display: "flex", alignItems: "center", gap: "6px" }}
                >
                  <div
                    style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      flexShrink: 0,
                      background: DOT_COLORS[i % DOT_COLORS.length],
                    }}
                  />
                  <span
                    style={{
                      fontSize: "12px",
                      color: "var(--text-primary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {model}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </WidgetContainer>
  );
}
