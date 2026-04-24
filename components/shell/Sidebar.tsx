"use client";

import React, { memo, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDeckSettings } from "@/components/settings/DeckSettingsProvider";
import { useThreadManager } from "@/lib/hooks/useThreadManager";
import { useWidgets } from "@/lib/hooks/useWidgets";
import { Icon } from "@/components/warp/Icons";

const ITEMS = [
  { href: "/deck/chat", label: "Chat", icon: Icon.Chat, kbd: "1" },
  { href: "/deck/terminal", label: "Terminal", icon: Icon.Terminal, kbd: "2" },
  { href: "/deck/compare", label: "Compare", icon: Icon.Columns, kbd: "c" },
  { href: "/deck/visual", label: "Visual", icon: Icon.Image, kbd: "3" },
  { href: "/deck/audio", label: "Audio", icon: Icon.Waveform, kbd: "4" },
  { href: "/deck/models", label: "Models", icon: Icon.Cpu, kbd: "5" },
  { href: "/deck/control", label: "Control", icon: Icon.Layers, kbd: "6" },
  { href: "/deck/workspace", label: "Workspace", icon: Icon.Grid, kbd: "7" },
  { href: "/deck/capabilities", label: "Capabilities", icon: Icon.Wrench, kbd: "8" },
  { href: "/deck/hardware", label: "Hardware", icon: Icon.Cpu, kbd: "9" },
  { href: "/deck/settings", label: "Settings", icon: Icon.Settings, kbd: "0" },
] as const;

interface SidebarProps {
  onOpenPalette: () => void;
}

export function Sidebar({ onOpenPalette }: SidebarProps) {
  const pathname = usePathname();
  const { setSettingsOpen } = useDeckSettings();

  return (
    <aside className="nav">
      <Link href="/deck/chat" className="nav-brand">
        <div className="nav-brand-mark">◆</div>
        <div className="nav-brand-word">
          <div className="nav-brand-name">Control Deck</div>
          <div className="nav-brand-sub">Warp ed.</div>
        </div>
      </Link>

      <div className="nav-section">Surfaces</div>
      {ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const ItemIcon = item.icon;
        return (
          <Link key={item.href} href={item.href} className={`nav-item ${active ? "on" : ""}`}>
            <ItemIcon size={13} sw={1.25} />
            <span className="nav-item-label">{item.label}</span>
            <span className="kbd">{item.kbd}</span>
          </Link>
        );
      })}

      <div className="nav-section">Session</div>
      <button
        className="nav-item"
        onClick={() => setSettingsOpen(true)}
        title="Quick settings drawer (⌘,)"
      >
        <Icon.Settings size={13} sw={1.25} />
        <span className="nav-item-label">Quick settings</span>
        <span className="kbd">⌘,</span>
      </button>
      <button className="nav-item" onClick={onOpenPalette}>
        <Icon.CommandIcon size={13} sw={1.25} />
        <span className="nav-item-label">Command</span>
        <span className="kbd">⌘K</span>
      </button>

      <NowPanel />
    </aside>
  );
}

const NowPanel = memo(function NowPanel() {
  const { threads, activeThreadId } = useThreadManager();
  const { data } = useWidgets();
  const stats = data.stats;
  const activeThread = activeThreadId
    ? threads.find((t) => t.id === activeThreadId)
    : null;

  const [openMin, setOpenMin] = useState<number>(() =>
    stats ? minutesSince(stats.sessionStart) : 0
  );

  useEffect(() => {
    if (!stats) return;
    setOpenMin(minutesSince(stats.sessionStart));
    const id = setInterval(() => setOpenMin(minutesSince(stats.sessionStart)), 60_000);
    return () => clearInterval(id);
  }, [stats?.sessionStart]);

  const title = activeThread?.title?.trim() || "New thread";

  return (
    <div className="nav-now" aria-label="Session status">
      <div className="nav-now-label">NOW</div>
      <div className="nav-now-entry" title={title}>
        <span className="nav-now-dot" />
        <span className="nav-now-title">{title}</span>
      </div>
      <div className="nav-now-stats">
        <NowStat label="Msgs" value={stats?.messagesCount ?? 0} />
        <NowStat label="Tools" value={stats?.toolCalls ?? 0} />
        <NowStat label="Open" value={`${openMin}m`} />
        <NowStat label="Spend" value="—" />
      </div>
    </div>
  );
});

function NowStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="nav-now-stat">
      <span className="nav-now-stat-label">{label}</span>
      <span className="nav-now-stat-value">{value}</span>
    </div>
  );
}

function minutesSince(iso: string): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 60_000));
}
