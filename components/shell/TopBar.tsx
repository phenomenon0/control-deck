"use client";

import { Icon } from "@/components/warp/Icons";

interface TopBarProps {
  title: string;
  subtitle?: string;
  model?: string;
  onInspector?: () => void;
}

export function TopBar({ title, subtitle, model, onInspector }: TopBarProps) {
  return (
    <div className="topbar">
      <div className="topbar-crumb">
        {subtitle && (
          <>
            <span>{subtitle}</span>
            <span style={{ margin: "0 8px", opacity: 0.4 }}>/</span>
          </>
        )}
        <b>{title}</b>
      </div>
      <div className="topbar-spacer" />
      {model && (
        <div className="topbar-model">
          <span className="topbar-model-dot" />
          <span>{model}</span>
        </div>
      )}
      <button className="topbar-icon" title="Canvas">
        <Icon.Expand size={14} />
      </button>
      <button className="topbar-icon" title="Inspector" onClick={onInspector}>
        <Icon.Grid size={14} />
      </button>
      <button className="topbar-icon" title="Command">
        <Icon.CommandIcon size={14} />
      </button>
    </div>
  );
}
