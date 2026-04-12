"use client";

import { Brain } from "lucide-react";
import { WidgetContainer } from "@/components/widgets/WidgetContainer";
import { useModels } from "@/lib/hooks/useModels";

const DOT_COLORS = [
  "#7c6af7",
  "#4fa3e0",
  "#e06c75",
  "#56b6c2",
  "#e5c07b",
  "#98c379",
];

function formatModelName(model: string): string {
  let name = model;
  const slashIdx = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
  if (slashIdx !== -1) {
    name = name.slice(slashIdx + 1);
  }
  if (name.toLowerCase().endsWith(".gguf")) {
    name = name.slice(0, -5);
  }
  return name;
}

export function ModelFleetWidget() {
  const { models } = useModels();

  const badge = `${models.length} model${models.length !== 1 ? "s" : ""}`;

  return (
    <WidgetContainer
      title="Model Fleet"
      icon={<Brain size={14} />}
      badge={badge}
      defaultExpanded={false}
    >
      {models.length === 0 ? (
        <div
          style={{
            color: "var(--text-muted)",
            fontSize: "12px",
            padding: "8px 0",
            textAlign: "center",
          }}
        >
          No models available
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {models.map((model, i) => (
            <div
              key={model}
              style={{ display: "flex", alignItems: "center", gap: "8px" }}
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
                title={model}
              >
                {formatModelName(model)}
              </span>
            </div>
          ))}
        </div>
      )}
    </WidgetContainer>
  );
}
