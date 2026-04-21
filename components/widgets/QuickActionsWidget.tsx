"use client";

import { Zap, MessageSquare, Mic, ImageIcon, Bot, Brain, Wrench } from "lucide-react";
import { useRouter } from "next/navigation";
import { WidgetContainer } from "@/components/widgets/WidgetContainer";
import { Icon } from "@/components/warp/Icons";

interface Action {
  label: string;
  icon: React.ReactNode;
  href: string;
}

const ACTIONS: Action[] = [
  { label: "New Chat", icon: <MessageSquare size={14} />, href: "/deck/chat?new=1" },
  { label: "Voice Mode", icon: <Mic size={14} />, href: "/deck/voice" },
  { label: "Generate Image", icon: <ImageIcon size={14} />, href: "/deck/comfy" },
  { label: "Run Agent", icon: <Bot size={14} />, href: "/deck/agentgo" },
  { label: "Models", icon: <Brain size={14} />, href: "/deck/models" },
  { label: "Terminal", icon: <Icon.Terminal size={14} />, href: "/deck/terminal" },
  { label: "Tools", icon: <Wrench size={14} />, href: "/deck/tools" },
];

export function QuickActionsWidget() {
  const router = useRouter();

  return (
    <WidgetContainer
      title="Quick Actions"
      icon={<Zap size={14} />}
      defaultExpanded={true}
    >
      <style>{`
        .quick-actions-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 8px;
        }
      `}</style>
      <div className="quick-actions-grid">
        {ACTIONS.map((action) => (
          <button
            key={action.href}
            onClick={() => router.push(action.href)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 10px",
              background: "var(--bg-tertiary)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              color: "var(--text-primary)",
              fontSize: "12px",
              cursor: "pointer",
              textAlign: "left",
              transition: "background 0.15s ease, border-color 0.15s ease",
              width: "100%",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                "var(--accent)";
              (e.currentTarget as HTMLButtonElement).style.borderColor =
                "var(--accent)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                "var(--bg-tertiary)";
              (e.currentTarget as HTMLButtonElement).style.borderColor =
                "var(--border)";
            }}
          >
            <span style={{ flexShrink: 0, opacity: 0.8 }}>{action.icon}</span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {action.label}
            </span>
          </button>
        ))}
      </div>
    </WidgetContainer>
  );
}
